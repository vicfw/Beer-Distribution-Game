import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROLES, type Role } from '@beer-game/shared';
import { describe, expect, it } from 'vitest';
import { claimRole, isRoundComplete, processRound, startGame, submitOrder } from '../../domain/game/GameEngine.js';
import { DomainError } from '../../domain/game/errors.js';
import { classicRules } from '../../domain/game/gameRules.js';
import { openDatabase } from './client.js';
import { GameRepository, type GameRecord, type PlayerRecord } from './GameRepository.js';
import { migrationsApplied } from './migrations.js';

const NOW = '2026-01-01T00:00:00.000Z';

function memoryRepo() {
  const opened = openDatabase(':memory:');
  return { ...opened, repo: new GameRepository(opened.sqlite, opened.db) };
}

function fileRepo(filename: string) {
  const opened = openDatabase(filename);
  return { ...opened, repo: new GameRepository(opened.sqlite, opened.db) };
}

describe('schema', () => {
  it('applies migrations and enforces one player per role', () => {
    const { sqlite, db, repo } = memoryRepo();
    expect(migrationsApplied(sqlite)).toBe(true);
    const game = repo.create({ id: 'g1', code: 'SCHEMA1', rules: classicRules(), now: NOW });
    const insert = sqlite.prepare(
      `INSERT INTO players (id, game_id, role, token_hash, created_at, updated_at) VALUES (?, ?, 'retailer', ?, ?, ?)`,
    );
    insert.run('p1', game.id, 'h1', NOW, NOW);
    expect(() => insert.run('p2', game.id, 'h2', NOW, NOW)).toThrow(/UNIQUE/);
    sqlite.close();
    expect(db).toBeDefined();
  });

  it('rejects two orders for the same role in one round', () => {
    const { sqlite, repo } = memoryRepo();
    const game = seatAll(repo, 'ORDER1');
    const roundId = game.id;
    sqlite
      .prepare(
        `INSERT INTO orders (id, game_id, round_number, player_id, role, quantity, submission_id, created_at)
         VALUES ('o1', ?, 1, ?, 'retailer', 4, 'sub-1', ?)`,
      )
      .run(roundId, playerId(game, 'retailer'), NOW);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO orders (id, game_id, round_number, player_id, role, quantity, submission_id, created_at)
           VALUES ('o2', ?, 1, ?, 'retailer', 9, 'sub-2', ?)`,
        )
        .run(roundId, playerId(game, 'retailer'), NOW),
    ).toThrow(/UNIQUE/);
    sqlite.close();
  });
});

describe('rehydration', () => {
  it('folds the order log back into the same state after a restart', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'beer-game-')), 'game.sqlite');
    const first = fileRepo(file);
    seatAll(first.repo, 'REPLAY1');
    submitAll(first.repo, 'REPLAY1', 1, 4);
    submitAll(first.repo, 'REPLAY1', 2, { retailer: 8, wholesaler: 4, distributor: 4, factory: 4 });
    const before = first.repo.findByCode('REPLAY1');
    first.sqlite.close();

    const second = fileRepo(file);
    const after = second.repo.findByCode('REPLAY1');
    expect(after?.version).toBe(before?.version);
    expect(after?.state.round).toBe(3);
    expect(after?.state.roles.retailer.totalCostCents).toBe(before?.state.roles.retailer.totalCostCents);
    expect(after?.state.roles.wholesaler.incomingOrder).toBe(before?.state.roles.wholesaler.incomingOrder);
    expect(after?.players).toHaveLength(4);
    second.sqlite.close();
  });

  it('keeps a partial round waiting and records the classic cost totals', () => {
    const { sqlite, repo } = memoryRepo();
    const game = seatAll(repo, 'CLASSIC');
    for (let round = 1; round <= 20; round += 1) {
      submitAll(repo, 'CLASSIC', round, 4);
    }
    const finished = repo.findByCode('CLASSIC');
    expect(finished?.state.status).toBe('finished');
    expect(finished?.state.roles.retailer.totalCostCents).toBe(39400);
    const debrief = repo.loadDebrief(game.id);
    expect(debrief?.totalCostCents).toBe(75400);
    expect(debrief?.rounds).toHaveLength(20);
    expect(debrief?.rounds[7]?.roles.retailer).toMatchObject({
      shipmentArrived: 4,
      incomingOrder: 8,
      shipped: 4,
      inventory: 0,
      backlog: 4,
      orderPlaced: 4,
    });
    expect(repo.roundStatus(game.id, 1)).toBe('completed');
    expect(repo.roundStatus(game.id, 20)).toBe('completed');

    const claim = sqlite
      .prepare(
        `UPDATE rounds SET status = 'processing' WHERE game_id = ? AND number = 20 AND status = 'awaiting_orders'`,
      )
      .run(game.id);
    expect(claim.changes).toBe(0);
    sqlite.close();
  });
});

describe('partial round on a reopened file', () => {
  it('restores who has already ordered', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'beer-game-')), 'partial.sqlite');
    const first = fileRepo(file);
    seatAll(first.repo, 'PART01');
    submitOne(first.repo, 'PART01', 'retailer', 6, 'sub-retailer');
    submitOne(first.repo, 'PART01', 'factory', 2, 'sub-factory');
    first.sqlite.close();

    const second = fileRepo(file);
    const game = second.repo.findByCode('PART01');
    expect(game?.state.round).toBe(1);
    expect(game?.state.pendingOrders).toEqual({ retailer: 6, factory: 2 });
    expect(second.repo.roundStatus(game?.id ?? '', 1)).toBe('awaiting_orders');
    second.sqlite.close();
  });
});

function seatAll(repo: GameRepository, code: string): GameRecord {
  repo.create({ id: `game-${code}`, code, rules: classicRules(), now: NOW });
  let latest: GameRecord | undefined;
  for (const role of ROLES) {
    const player: PlayerRecord = {
      id: `player-${code}-${role}`,
      gameId: `game-${code}`,
      role,
      tokenHash: `token-${code}-${role}`,
      createdAt: NOW,
      updatedAt: NOW,
    };
    latest = repo.withGame(code, NOW, (game) => {
      let state = claimRole(game.state, role);
      let next: GameRecord = { ...game, state, players: [...game.players, player] };
      if (ROLES.every((candidate) => next.players.some((seated) => seated.role === candidate))) {
        state = startGame(state);
        next = { ...next, state };
      }
      return { commit: { next, orders: [] }, value: true };
    }).game;
  }
  if (!latest) throw new Error('game was not created');
  return latest;
}

function submitAll(
  repo: GameRepository,
  code: string,
  round: number,
  quantity: number | Partial<Record<Role, number>>,
): void {
  for (const role of ROLES) {
    const amount = typeof quantity === 'number' ? quantity : (quantity[role] ?? 4);
    submitOne(repo, code, role, amount, `sub-${code}-${round}-${role}`);
  }
}

function submitOne(repo: GameRepository, code: string, role: Role, quantity: number, submissionId: string): void {
  repo.withGame(code, NOW, (game) => {
    const player = game.players.find((candidate) => candidate.role === role);
    if (!player) throw new DomainError('PLAYER_NOT_AUTHORIZED', 'missing player');
    let state = submitOrder(game.state, role, quantity);
    if (isRoundComplete(state)) state = processRound(state);
    return {
      commit: {
        next: { ...game, state },
        orders: [
          {
            id: submissionId,
            playerId: player.id,
            role,
            round: game.state.round,
            quantity,
            submissionId,
          },
        ],
      },
      value: true,
    };
  });
}

function playerId(game: GameRecord, role: Role): string {
  const player = game.players.find((candidate) => candidate.role === role);
  if (!player) throw new Error(`missing ${role}`);
  return player.id;
}
