import type { Role } from './roles.js';

/** What a client may ask for when creating a game. The server fills in the classic defaults. */
export type CreateGameInput = {
  holdingCost?: number;
  backlogCost?: number;
  shippingDelay?: number;
  initialInventory?: number;
  initialBacklog?: number;
  roundCount?: number;
  demandSequence?: number[];
};

/** Rules a player is allowed to know while the game is running. Future demand is not included. */
export type PublicRules = {
  holdingCostCents: number;
  backlogCostCents: number;
  shippingDelay: number;
  initialInventory: number;
  initialBacklog: number;
  roundCount: number;
};

export type RoleRoundFacts = {
  shipmentArrived: number;
  incomingOrder: number;
  shipped: number;
  inventory: number;
  backlog: number;
  roundCostCents: number;
  totalCostCents: number;
  orderPlaced: number;
};

export type PublicRound = {
  round: number;
  customerDemand: number;
  roles: Record<Role, RoleRoundFacts>;
};

export type Debrief = {
  totalCostCents: number;
  costs: Record<Role, number>;
  rounds: PublicRound[];
};
