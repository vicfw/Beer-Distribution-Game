import type { CreateGameInput } from '@beer-game/shared';
import { DomainError } from './errors.js';

/**
 * Immutable rules for one game.
 * Costs are integer cents so a rate like 0.5 never drifts through binary floats.
 */
export type GameRules = {
  holdingCostCents: number;
  backlogCostCents: number;
  shippingDelay: number;
  initialInventory: number;
  initialBacklog: number;
  /** Length equals shippingDelay. Index 0 arrives on the next round. */
  initialShipmentsInTransit: number[];
  initialLastOrder: number;
  roundCount: number;
  /** Index 0 is round 1. */
  demandSequence: number[];
};

const CLASSIC_INITIAL_ORDER = 4;

export function defaultDemand(roundCount: number): number[] {
  return Array.from({ length: roundCount }, (_, index) => (index < 4 ? 4 : 8));
}

export function classicRules(): GameRules {
  return normalizeRules({});
}

export function normalizeRules(input: CreateGameInput): GameRules {
  const shippingDelay = input.shippingDelay ?? 2;
  const roundCount = input.demandSequence?.length ?? input.roundCount ?? 20;
  const demandSequence = input.demandSequence ?? defaultDemand(roundCount);

  if (input.roundCount !== undefined && input.demandSequence !== undefined) {
    if (input.roundCount !== input.demandSequence.length) {
      throw new DomainError(
        'INVALID_RULES',
        'Round count and the demand sequence must be the same length',
      );
    }
  }

  if (demandSequence.length !== roundCount) {
    throw new DomainError('INVALID_RULES', 'Demand sequence does not cover every round');
  }

  const initialLastOrder = CLASSIC_INITIAL_ORDER;
  const initialShipmentsInTransit = Array.from({ length: shippingDelay }, () => initialLastOrder);

  return {
    holdingCostCents: dollarsToCents(input.holdingCost ?? 0.5),
    backlogCostCents: dollarsToCents(input.backlogCost ?? 1),
    shippingDelay,
    initialInventory: input.initialInventory ?? 12,
    initialBacklog: input.initialBacklog ?? 0,
    initialShipmentsInTransit,
    initialLastOrder,
    roundCount,
    demandSequence,
  };
}

function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}
