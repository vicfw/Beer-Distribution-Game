import type {
  Debrief,
  LobbyResponse,
  PlayerSnapshot,
  PublicPresence,
  PublicRules,
  SeatPublic,
  SpectatorSnapshot,
} from '@beer-game/shared';
import { ROLES } from '@beer-game/shared';
import { DomainError } from '../../domain/game/errors.js';
import type { GameRules } from '../../domain/game/gameRules.js';
import type { GameState } from '../../domain/game/GameState.js';
import type { GameRecord } from '../../infrastructure/database/GameRepository.js';

function publicRules(rules: GameRules): PublicRules {
  return {
    holdingCostCents: rules.holdingCostCents,
    backlogCostCents: rules.backlogCostCents,
    shippingDelay: rules.shippingDelay,
    initialInventory: rules.initialInventory,
    initialBacklog: rules.initialBacklog,
    roundCount: rules.roundCount,
  };
}

export function toSeats(game: GameRecord, connected: ReadonlySet<string>): SeatPublic[] {
  const seated = new Map(game.players.map((player) => [player.role, player]));
  return ROLES.map((role) => {
    const player = seated.get(role);
    return {
      role,
      taken: player !== undefined,
      connected: player !== undefined && connected.has(player.id),
      submitted: game.state.pendingOrders[role] !== undefined,
    };
  });
}

export function toLobby(game: GameRecord, connected: ReadonlySet<string>): LobbyResponse {
  return {
    code: game.code,
    status: game.state.status,
    round: game.state.round,
    roundCount: game.state.rules.roundCount,
    seats: toSeats(game, connected),
    rules: publicRules(game.state.rules),
  };
}

export function toPublicPresence(game: GameRecord, connected: ReadonlySet<string>): PublicPresence {
  return {
    version: game.version,
    ...toLobby(game, connected),
  };
}

export function toPlayerSnapshot(
  game: GameRecord,
  playerId: string,
  connected: ReadonlySet<string>,
): PlayerSnapshot {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new DomainError('PLAYER_NOT_AUTHORIZED', 'You are not seated in this game');
  const roleState = game.state.roles[player.role];
  const submittedQuantity = game.state.pendingOrders[player.role] ?? null;
  return {
    kind: 'player',
    version: game.version,
    code: game.code,
    status: game.state.status,
    round: game.state.round,
    roundCount: game.state.rules.roundCount,
    you: { playerId: player.id, role: player.role },
    station:
      game.state.status === 'lobby'
        ? null
        : {
            role: player.role,
            inventory: roleState.inventory,
            backlog: roleState.backlog,
            shipmentArrived: roleState.shipmentArrived,
            incomingOrder: roleState.incomingOrder,
            shipped: roleState.shipped,
            lastOrder: roleState.lastOrder,
            roundCostCents: roleState.roundCostCents,
            totalCostCents: roleState.totalCostCents,
            submitted: submittedQuantity !== null,
            submittedQuantity,
          },
    seats: toSeats(game, connected),
    history: game.state.history.map((record) => ({
      round: record.round,
      ...record.byRole[player.role],
    })),
    rules: publicRules(game.state.rules),
  };
}

export function toSpectatorSnapshot(
  game: GameRecord,
  connected: ReadonlySet<string>,
): SpectatorSnapshot {
  return {
    kind: 'spectator',
    version: game.version,
    code: game.code,
    status: game.state.status,
    round: game.state.round,
    roundCount: game.state.rules.roundCount,
    seats: toSeats(game, connected),
    rules: publicRules(game.state.rules),
    debrief: game.state.status === 'finished' ? toDebrief(game.state) : null,
  };
}

function toDebrief(state: GameState): Debrief {
  const costs = {
    retailer: state.roles.retailer.totalCostCents,
    wholesaler: state.roles.wholesaler.totalCostCents,
    distributor: state.roles.distributor.totalCostCents,
    factory: state.roles.factory.totalCostCents,
  };
  return {
    costs,
    totalCostCents: costs.retailer + costs.wholesaler + costs.distributor + costs.factory,
    rounds: state.history.map((record) => ({
      round: record.round,
      customerDemand: record.customerDemand,
      roles: record.byRole,
    })),
  };
}
