import type { Role } from '@beer-game/shared';

/** Who this role orders from. The factory orders from an unlimited supplier. */
const UPSTREAM: Record<Role, Role | null> = {
  retailer: 'wholesaler',
  wholesaler: 'distributor',
  distributor: 'factory',
  factory: null,
};

/** Who this role ships to. The retailer ships to the customer. */
const DOWNSTREAM: Record<Role, Role | null> = {
  retailer: null,
  wholesaler: 'retailer',
  distributor: 'wholesaler',
  factory: 'distributor',
};

export function upstreamOf(role: Role): Role | null {
  return UPSTREAM[role];
}

export function downstreamOf(role: Role): Role | null {
  return DOWNSTREAM[role];
}
