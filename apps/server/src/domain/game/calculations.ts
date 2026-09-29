import type { GameRules } from './gameRules.js';

export function roundCostCents(inventory: number, backlog: number, rules: GameRules): number {
  return inventory * rules.holdingCostCents + backlog * rules.backlogCostCents;
}

/**
 * Ship as much of (backlog + incoming order) as inventory allows.
 * After this, inventory and backlog are never both positive.
 */
export function fulfill(input: {
  inventoryAfterArrival: number;
  backlog: number;
  incomingOrder: number;
}): { shipped: number; inventory: number; backlog: number } {
  const owed = input.backlog + input.incomingOrder;
  const shipped = Math.min(input.inventoryAfterArrival, owed);
  return {
    shipped,
    inventory: input.inventoryAfterArrival - shipped,
    backlog: owed - shipped,
  };
}
