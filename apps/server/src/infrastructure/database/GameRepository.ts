import type { Debrief, PublicRound, Role, RoleRoundFacts } from '@beer-game/shared';
import { isRole, ROLES } from '@beer-game/shared';
import { and, eq } from 'drizzle-orm';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { createGame, replay } from '../../domain/game/GameEngine.js';
import { DomainError } from '../../domain/game/errors.js';
import type { GameRules } from '../../domain/game/gameRules.js';
import { cloneState, type GameState, type RoundRecord } from '../../domain/game/GameState.js';
import type { AppDatabase } from './client.js';
import { parseRules, serializeRules } from './rulesCodec.js';
import { games, orders, players, roundResults, rounds } from './schema.js';
import { translateSqliteError } from './sqliteErrors.js';

export type PlayerRecord = {
  id: string;
  gameId: string;
  role: Role;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
};

export type GameRecord = {
  id: string;
  code: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  state: GameState;
  players: PlayerRecord[];
};

export type NewOrder = {
  id: string;
  playerId: string;
  role: Role;
  round: number;
  quantity: number;
  submissionId: string;
};

export type StoredOrder = {
  id: string;
  gameId: string;
  roundNumber: number;
  playerId: string;
  role: Role;
  quantity: number;
  submissionId: string;
};

export type OrderLookup = {
  findBySubmissionId: (submissionId: string) => StoredOrder | undefined;
};

type Commit = {
  next: GameRecord;
  orders: NewOrder[];
};

/**
 * Orders are the source of truth. Live state is a fold of that log, cached in memory
 * after each commit. `round_results` is a read model written in the same transaction.
 */
export class GameRepository {
  private readonly byCode = new Map<string, GameRecord>();
  private readonly byId = new Map<string, GameRecord>();

  constructor(
    private readonly sqlite: SqliteDatabase,
    private readonly db: AppDatabase,
  ) {}

  create(input: { id: string; code: string; rules: GameRules; now: string }): GameRecord {
    const state = createGame(input.rules);
    const record: GameRecord = {
      id: input.id,
      code: input.code,
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
      state,
      players: [],
    };
    try {
      this.db
        .insert(games)
        .values({
          id: record.id,
          code: record.code,
          status: state.status,
          currentRound: state.round,
          rulesJson: serializeRules(input.rules),
          version: record.version,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        })
        .run();
    } catch (error) {
      throw translateSqliteError(error);
    }
    this.remember(record);
    return this.present(record);
  }

  findByCode(code: string): GameRecord | null {
    const cached = this.byCode.get(code);
    if (cached) return this.present(cached);
    const loaded = this.loadByCode(code);
    if (!loaded) return null;
    this.remember(loaded);
    return this.present(loaded);
  }

  findById(id: string): GameRecord | null {
    const cached = this.byId.get(id);
    if (cached) return this.present(cached);
    const row = this.db.select().from(games).where(eq(games.id, id)).get();
    if (!row) return null;
    const loaded = this.hydrate(row);
    this.remember(loaded);
    return this.present(loaded);
  }

  findPlayerByTokenHash(tokenHash: string): { game: GameRecord; player: PlayerRecord } | null {
    const row = this.db.select().from(players).where(eq(players.tokenHash, tokenHash)).get();
    if (!row || !isRole(row.role)) return null;
    const game = this.findById(row.gameId);
    const player = game?.players.find((candidate) => candidate.id === row.id);
    if (!game || !player) return null;
    return { game, player };
  }

  /**
   * Read-modify-write on one connection. better-sqlite3 runs the callback synchronously,
   * so two commands cannot interleave inside it.
   */
  withGame<T>(
    code: string,
    now: string,
    fn: (game: GameRecord, lookup: OrderLookup) => { commit: Commit | null; value: T },
  ): { game: GameRecord; value: T } {
    const lookup: OrderLookup = {
      findBySubmissionId: (submissionId) => this.findOrderBySubmissionId(submissionId),
    };
    let value: T | undefined;
    let stored: GameRecord | undefined;
    const run = this.sqlite.transaction(() => {
      const current = this.loadByCode(code);
      if (!current) throw new DomainError('GAME_NOT_FOUND', 'Game not found');
      const result = fn(this.present(current), lookup);
      if (result.commit) {
        this.persist(current, result.commit.next, result.commit.orders, now);
        stored = result.commit.next;
      } else {
        stored = current;
      }
      value = result.value;
    });
    try {
      run();
    } catch (error) {
      throw translateSqliteError(error);
    }
    if (!stored || value === undefined) {
      throw new DomainError('INVALID_GAME_STATE', 'The game could not be saved');
    }
    this.remember(stored);
    return { game: this.present(stored), value };
  }

  loadDebrief(gameId: string): Debrief | null {
    const resultRows = this.db.select().from(roundResults).where(eq(roundResults.gameId, gameId)).all();
    if (resultRows.length === 0) return null;
    const roundRows = this.db.select().from(rounds).where(eq(rounds.gameId, gameId)).all();
    const orderRows = this.db.select().from(orders).where(eq(orders.gameId, gameId)).all();
    const demandByRound = new Map(roundRows.map((row) => [row.number, row.customerDemand]));
    const orderByKey = new Map(orderRows.map((row) => [`${row.roundNumber}:${row.role}`, row.quantity]));

    const grouped = new Map<number, Partial<Record<Role, RoleRoundFacts>>>();
    for (const row of resultRows) {
      if (!isRole(row.role)) {
        throw new DomainError('INVALID_GAME_STATE', 'Stored result has an unknown role');
      }
      const orderPlaced = orderByKey.get(`${row.roundNumber}:${row.role}`);
      if (orderPlaced === undefined) {
        throw new DomainError('INVALID_GAME_STATE', 'A stored result is missing its order');
      }
      const bucket = grouped.get(row.roundNumber) ?? {};
      bucket[row.role] = {
        shipmentArrived: row.shipmentArrived,
        incomingOrder: row.incomingOrder,
        shipped: row.shipped,
        inventory: row.inventory,
        backlog: row.backlog,
        roundCostCents: row.roundCostCents,
        totalCostCents: row.totalCostCents,
        orderPlaced,
      };
      grouped.set(row.roundNumber, bucket);
    }

    const debriefRounds: PublicRound[] = [...grouped.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([round, roles]) => {
        const customerDemand = demandByRound.get(round);
        if (customerDemand === undefined || !isCompleteRoleMap(roles)) {
          throw new DomainError('INVALID_GAME_STATE', `Stored results for round ${round} are incomplete`);
        }
        return { round, customerDemand, roles };
      });

    const last = debriefRounds[debriefRounds.length - 1];
    if (!last) return null;
    const costs = {
      retailer: last.roles.retailer.totalCostCents,
      wholesaler: last.roles.wholesaler.totalCostCents,
      distributor: last.roles.distributor.totalCostCents,
      factory: last.roles.factory.totalCostCents,
    };
    return {
      costs,
      totalCostCents: costs.retailer + costs.wholesaler + costs.distributor + costs.factory,
      rounds: debriefRounds,
    };
  }

  roundStatus(gameId: string, round: number): string | undefined {
    const row = this.db
      .select({ status: rounds.status })
      .from(rounds)
      .where(and(eq(rounds.gameId, gameId), eq(rounds.number, round)))
      .get();
    return row?.status;
  }

  private findOrderBySubmissionId(submissionId: string): StoredOrder | undefined {
    const row = this.db.select().from(orders).where(eq(orders.submissionId, submissionId)).get();
    if (!row || !isRole(row.role)) return undefined;
    return {
      id: row.id,
      gameId: row.gameId,
      roundNumber: row.roundNumber,
      playerId: row.playerId,
      role: row.role,
      quantity: row.quantity,
      submissionId: row.submissionId,
    };
  }

  private persist(current: GameRecord, next: GameRecord, ordersToInsert: NewOrder[], now: string): void {
    const version = current.version + 1;
    const updated = this.db
      .update(games)
      .set({
        status: next.state.status,
        currentRound: next.state.round,
        version,
        updatedAt: now,
      })
      .where(and(eq(games.id, current.id), eq(games.version, current.version)))
      .run();
    if (updated.changes !== 1) {
      throw new DomainError('INVALID_GAME_STATE', 'The game changed before this action could be saved');
    }
    next.version = version;
    next.updatedAt = now;

    const nextIds = new Set(next.players.map((player) => player.id));
    const currentIds = new Set(current.players.map((player) => player.id));
    for (const player of current.players) {
      if (!nextIds.has(player.id)) {
        this.db.delete(players).where(eq(players.id, player.id)).run();
      }
    }
    for (const player of next.players) {
      if (!currentIds.has(player.id)) {
        this.db
          .insert(players)
          .values({
            id: player.id,
            gameId: next.id,
            role: player.role,
            tokenHash: player.tokenHash,
            createdAt: player.createdAt,
            updatedAt: player.updatedAt,
          })
          .run();
      }
    }

    if (current.state.status === 'lobby' && next.state.status === 'playing') {
      this.insertRound(next, next.state.round, now);
    }

    for (const order of ordersToInsert) {
      this.db
        .insert(orders)
        .values({
          id: order.id,
          gameId: next.id,
          roundNumber: order.round,
          playerId: order.playerId,
          role: order.role,
          quantity: order.quantity,
          submissionId: order.submissionId,
          createdAt: now,
        })
        .run();
    }

    if (next.state.history.length === current.state.history.length + 1) {
      const record = next.state.history[next.state.history.length - 1];
      if (!record) throw new DomainError('INVALID_GAME_STATE', 'Missing round record');
      this.completeRound(next.id, record, now);
    }

    if (
      current.state.status === 'playing' &&
      next.state.status === 'playing' &&
      next.state.round > current.state.round
    ) {
      this.insertRound(next, next.state.round, now);
    }
  }

  private insertRound(game: GameRecord, roundNumber: number, now: string): void {
    const demand = game.state.rules.demandSequence[roundNumber - 1];
    if (demand === undefined) {
      throw new DomainError('INVALID_GAME_STATE', `No demand stored for round ${roundNumber}`);
    }
    this.db
      .insert(rounds)
      .values({
        gameId: game.id,
        number: roundNumber,
        status: 'awaiting_orders',
        customerDemand: demand,
        startedAt: now,
        completedAt: null,
      })
      .run();
  }

  private completeRound(gameId: string, record: RoundRecord, now: string): void {
    const claim = this.sqlite
      .prepare(
        `UPDATE rounds SET status = 'processing' WHERE game_id = ? AND number = ? AND status = 'awaiting_orders'`,
      )
      .run(gameId, record.round);
    if (claim.changes !== 1) {
      throw new DomainError('INVALID_GAME_STATE', 'This round was already processed');
    }
    this.sqlite
      .prepare(
        `UPDATE rounds SET status = 'completed', completed_at = ? WHERE game_id = ? AND number = ? AND status = 'processing'`,
      )
      .run(now, gameId, record.round);

    for (const role of ROLES) {
      const facts = record.byRole[role];
      this.db
        .insert(roundResults)
        .values({
          gameId,
          roundNumber: record.round,
          role,
          shipmentArrived: facts.shipmentArrived,
          incomingOrder: facts.incomingOrder,
          shipped: facts.shipped,
          inventory: facts.inventory,
          backlog: facts.backlog,
          roundCostCents: facts.roundCostCents,
          totalCostCents: facts.totalCostCents,
        })
        .run();
    }
  }

  private loadByCode(code: string): GameRecord | null {
    const row = this.db.select().from(games).where(eq(games.code, code)).get();
    if (!row) return null;
    return this.hydrate(row);
  }

  private hydrate(row: typeof games.$inferSelect): GameRecord {
    const rules = parseRules(row.rulesJson);
    const playerRows = this.db.select().from(players).where(eq(players.gameId, row.id)).all();
    const orderRows = this.db.select().from(orders).where(eq(orders.gameId, row.id)).all();
    const playerList: PlayerRecord[] = playerRows.map((player) => {
      if (!isRole(player.role)) throw new DomainError('INVALID_GAME_STATE', 'Stored player has an unknown role');
      return {
        id: player.id,
        gameId: player.gameId,
        role: player.role,
        tokenHash: player.tokenHash,
        createdAt: player.createdAt,
        updatedAt: player.updatedAt,
      };
    });

    const ordersByRound = new Map<number, Partial<Record<Role, number>>>();
    for (const order of orderRows) {
      if (!isRole(order.role)) throw new DomainError('INVALID_GAME_STATE', 'Stored order has an unknown role');
      const bucket = ordersByRound.get(order.roundNumber) ?? {};
      bucket[order.role] = order.quantity;
      ordersByRound.set(order.roundNumber, bucket);
    }

    const state = replay(
      rules,
      playerList.map((player) => player.role),
      ordersByRound,
    );
    if (state.status !== row.status || state.round !== row.currentRound) {
      throw new DomainError('INVALID_GAME_STATE', 'Stored game header does not match the order log');
    }

    return {
      id: row.id,
      code: row.code,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      state,
      players: playerList,
    };
  }

  private remember(game: GameRecord): void {
    this.byCode.set(game.code, game);
    this.byId.set(game.id, game);
  }

  private present(game: GameRecord): GameRecord {
    return {
      ...game,
      players: game.players.map((player) => ({ ...player })),
      state: cloneState(game.state),
    };
  }
}

function isCompleteRoleMap(roles: Partial<Record<Role, RoleRoundFacts>>): roles is Record<Role, RoleRoundFacts> {
  return ROLES.every((role) => roles[role] !== undefined);
}
