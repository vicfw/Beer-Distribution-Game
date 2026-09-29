import { MAX_ORDER_QUANTITY, ROLES, type Role } from '@beer-game/shared';
import { fulfill, roundCostCents } from './calculations.js';
import { downstreamOf, upstreamOf } from './chain.js';
import { DomainError } from './errors.js';
import type { GameRules } from './gameRules.js';
import { classicRules } from './gameRules.js';
import {
  mapRoles,
  type GameState,
  type RoleState,
  type RoundRecord,
  type RoundRoleResult,
} from './GameState.js';

export function createGame(rules: GameRules = classicRules()): GameState {
  return {
    status: 'lobby',
    round: 0,
    rules,
    seats: {},
    roles: mapRoles({} as Record<Role, RoleState>, () => initialRole(rules)),
    pendingOrders: {},
    history: [],
  };
}

export function claimRole(state: GameState, role: Role): GameState {
  if (state.status !== 'lobby') {
    throw new DomainError('GAME_ALREADY_STARTED', 'Roles can only be claimed before the game starts');
  }
  if (state.seats[role]) {
    throw new DomainError('ROLE_ALREADY_TAKEN', `${role} is already taken`);
  }
  return { ...state, seats: { ...state.seats, [role]: true } };
}

export function releaseRole(state: GameState, role: Role): GameState {
  if (state.status !== 'lobby') {
    throw new DomainError('INVALID_GAME_STATE', 'A seat can only be released from the lobby');
  }
  if (!state.seats[role]) {
    throw new DomainError('INVALID_GAME_STATE', `${role} is not taken`);
  }
  const seats = { ...state.seats };
  delete seats[role];
  return { ...state, seats };
}

/**
 * Steps 1–4 of round 1 run for every role at once. The game then waits for orders.
 */
export function startGame(state: GameState): GameState {
  if (state.status !== 'lobby') {
    throw new DomainError('GAME_ALREADY_STARTED', 'The game has already started');
  }
  if (!allSeatsTaken(state)) {
    throw new DomainError('INVALID_GAME_STATE', 'All four roles must be taken before the game starts');
  }
  return {
    ...applyMechanics(state, 1),
    status: 'playing',
    round: 1,
    pendingOrders: {},
  };
}

export function submitOrder(state: GameState, role: Role, quantity: number): GameState {
  if (state.status === 'finished') {
    throw new DomainError('GAME_FINISHED', 'The game is over');
  }
  if (state.status !== 'playing') {
    throw new DomainError('ROUND_NOT_ACTIVE', 'The round is not accepting orders');
  }
  if (!state.seats[role]) {
    throw new DomainError('PLAYER_NOT_AUTHORIZED', 'That role is not in this game');
  }
  assertQuantity(quantity);
  if (state.pendingOrders[role] !== undefined) {
    throw new DomainError('ALREADY_SUBMITTED', 'An order was already submitted for this role this round');
  }
  return {
    ...state,
    pendingOrders: { ...state.pendingOrders, [role]: quantity },
  };
}

export function isRoundComplete(state: GameState): boolean {
  return ROLES.every((role) => state.pendingOrders[role] !== undefined);
}

/**
 * Records this round's orders, then either finishes the game or runs steps 1–4 of the next round.
 * Calling this twice on the same state throws: the pending orders are consumed.
 */
export function processRound(state: GameState): GameState {
  if (state.status !== 'playing') {
    throw new DomainError('INVALID_GAME_STATE', 'There is no active round to process');
  }
  if (!isRoundComplete(state)) {
    throw new DomainError('INVALID_GAME_STATE', 'The round cannot advance until every role has ordered');
  }

  const record = buildRecord(state);
  const withOrders: GameState = {
    ...state,
    roles: mapRoles(state.roles, (role, roleState) => ({
      ...roleState,
      lastOrder: requiredOrder(state, role),
    })),
    pendingOrders: {},
    history: [...state.history, record],
  };

  if (state.round >= state.rules.roundCount) {
    return { ...withOrders, status: 'finished' };
  }

  const nextRound = state.round + 1;
  return {
    ...applyMechanics(withOrders, nextRound),
    status: 'playing',
    round: nextRound,
  };
}

/**
 * Folds an order log back into state. Used by tests and by the database when a process restarts.
 * `ordersByRound` is keyed by round number. A round with four orders is completed.
 * A trailing partial round is left waiting.
 */
export function replay(rules: GameRules, seated: readonly Role[], ordersByRound: Map<number, Partial<Record<Role, number>>>): GameState {
  let state = createGame(rules);
  for (const role of seated) {
    state = claimRole(state, role);
  }
  if (!allSeatsTaken(state)) {
    return state;
  }
  state = startGame(state);

  const rounds = [...ordersByRound.keys()].sort((a, b) => a - b);
  for (const round of rounds) {
    if (state.status !== 'playing' || state.round !== round) {
      throw new DomainError('INVALID_GAME_STATE', `Order log is inconsistent at round ${round}`);
    }
    const orders = ordersByRound.get(round) ?? {};
    for (const role of ROLES) {
      const quantity = orders[role];
      if (quantity === undefined) continue;
      state = submitOrder(state, role, quantity);
    }
    if (isRoundComplete(state)) {
      state = processRound(state);
    }
  }
  return state;
}

/**
 * Steps 1–4 for every role, computed from the pre-round snapshot so no role observes
 * another role's update from the same round.
 */
function applyMechanics(state: GameState, roundNumber: number): GameState {
  const demand = state.rules.demandSequence[roundNumber - 1];
  if (demand === undefined) {
    throw new DomainError('INVALID_GAME_STATE', `No customer demand configured for round ${roundNumber}`);
  }

  const prev = state.roles;
  const draft = mapRoles(prev, (role, current) => {
    const arrived = current.pipeline[0];
    if (arrived === undefined) {
      throw new DomainError('INVALID_GAME_STATE', `Shipment pipeline for ${role} is empty`);
    }
    const inventoryAfterArrival = current.inventory + arrived;
    const incomingOrder = incomingFor(role, prev, demand);
    const shippedState = fulfill({
      inventoryAfterArrival,
      backlog: current.backlog,
      incomingOrder,
    });
    return {
      inventory: shippedState.inventory,
      backlog: shippedState.backlog,
      pipeline: current.pipeline.slice(1),
      lastOrder: current.lastOrder,
      totalCostCents: current.totalCostCents + roundCostCents(shippedState.inventory, shippedState.backlog, state.rules),
      shipmentArrived: arrived,
      incomingOrder,
      shipped: shippedState.shipped,
      roundCostCents: roundCostCents(shippedState.inventory, shippedState.backlog, state.rules),
    };
  });

  const roles = mapRoles(draft, (role, current) => {
    const upstream = upstreamOf(role);
    // The factory's supplier is unlimited and ships exactly what the factory ordered last round.
    const incomingShipment = upstream ? draft[upstream].shipped : prev.factory.lastOrder;
    return { ...current, pipeline: [...current.pipeline, incomingShipment] };
  });

  return { ...state, roles };
}

function incomingFor(role: Role, prev: Record<Role, RoleState>, demand: number): number {
  if (role === 'retailer') return demand;
  const downstream = downstreamOf(role);
  if (!downstream) {
    throw new DomainError('INVALID_GAME_STATE', `${role} has no downstream order source`);
  }
  return prev[downstream].lastOrder;
}

function buildRecord(state: GameState): RoundRecord {
  const customerDemand = state.rules.demandSequence[state.round - 1];
  if (customerDemand === undefined) {
    throw new DomainError('INVALID_GAME_STATE', 'Missing demand for the round being recorded');
  }
  return {
    round: state.round,
    customerDemand,
    byRole: mapRoles(state.roles, (role, roleState) => toResult(roleState, requiredOrder(state, role))),
  };
}

function toResult(roleState: RoleState, orderPlaced: number): RoundRoleResult {
  return {
    shipmentArrived: roleState.shipmentArrived,
    incomingOrder: roleState.incomingOrder,
    shipped: roleState.shipped,
    inventory: roleState.inventory,
    backlog: roleState.backlog,
    roundCostCents: roleState.roundCostCents,
    totalCostCents: roleState.totalCostCents,
    orderPlaced,
  };
}

function requiredOrder(state: GameState, role: Role): number {
  const quantity = state.pendingOrders[role];
  if (quantity === undefined) {
    throw new DomainError('INVALID_GAME_STATE', `Missing order for ${role}`);
  }
  return quantity;
}

function initialRole(rules: GameRules): RoleState {
  return {
    inventory: rules.initialInventory,
    backlog: rules.initialBacklog,
    pipeline: [...rules.initialShipmentsInTransit],
    lastOrder: rules.initialLastOrder,
    totalCostCents: 0,
    shipmentArrived: 0,
    incomingOrder: 0,
    shipped: 0,
    roundCostCents: 0,
  };
}

function allSeatsTaken(state: GameState): boolean {
  return ROLES.every((role) => state.seats[role] === true);
}

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_ORDER_QUANTITY) {
    throw new DomainError('INVALID_ORDER', `Order must be an integer from 0 to ${MAX_ORDER_QUANTITY}`);
  }
}
