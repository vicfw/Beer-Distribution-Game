import type { GameStatus, Role } from '@beer-game/shared';
import type { GameRules } from './gameRules.js';

export type RoleState = {
  inventory: number;
  backlog: number;
  pipeline: number[];
  lastOrder: number;
  totalCostCents: number;
  shipmentArrived: number;
  incomingOrder: number;
  shipped: number;
  roundCostCents: number;
};

export type RoundRoleResult = {
  shipmentArrived: number;
  incomingOrder: number;
  shipped: number;
  inventory: number;
  backlog: number;
  roundCostCents: number;
  totalCostCents: number;
  orderPlaced: number;
};

export type RoundRecord = {
  round: number;
  customerDemand: number;
  byRole: Record<Role, RoundRoleResult>;
};

export type GameState = {
  status: GameStatus;
  /** 0 in the lobby, otherwise the round currently waiting for orders (or the last round, once finished). */
  round: number;
  rules: GameRules;
  seats: Partial<Record<Role, true>>;
  roles: Record<Role, RoleState>;
  /** Orders accepted for the current round, keyed by role. Cleared when the round advances. */
  pendingOrders: Partial<Record<Role, number>>;
  history: RoundRecord[];
};

export function cloneState(state: GameState): GameState {
  return {
    status: state.status,
    round: state.round,
    rules: {
      ...state.rules,
      initialShipmentsInTransit: [...state.rules.initialShipmentsInTransit],
      demandSequence: [...state.rules.demandSequence],
    },
    seats: { ...state.seats },
    roles: mapRoles(state.roles, (_role, roleState) => ({
      ...roleState,
      pipeline: [...roleState.pipeline],
    })),
    pendingOrders: { ...state.pendingOrders },
    history: state.history.map((record) => ({
      ...record,
      byRole: mapRoles(record.byRole, (_role, facts) => ({ ...facts })),
    })),
  };
}

export function mapRoles<T, U>(record: Record<Role, T>, map: (role: Role, value: T) => U): Record<Role, U> {
  return {
    retailer: map('retailer', record.retailer),
    wholesaler: map('wholesaler', record.wholesaler),
    distributor: map('distributor', record.distributor),
    factory: map('factory', record.factory),
  };
}
