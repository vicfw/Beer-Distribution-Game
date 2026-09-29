import { z } from 'zod';
import { DomainError } from '../../domain/game/errors.js';
import type { GameRules } from '../../domain/game/gameRules.js';

const rulesSchema = z
  .object({
    holdingCostCents: z.number().int().nonnegative(),
    backlogCostCents: z.number().int().nonnegative(),
    shippingDelay: z.number().int().positive(),
    initialInventory: z.number().int().nonnegative(),
    initialBacklog: z.number().int().nonnegative(),
    initialShipmentsInTransit: z.array(z.number().int().nonnegative()).min(1),
    initialLastOrder: z.number().int().nonnegative(),
    roundCount: z.number().int().positive(),
    demandSequence: z.array(z.number().int().nonnegative()).min(1),
  })
  .strict();

export function serializeRules(rules: GameRules): string {
  return JSON.stringify(rules);
}

export function parseRules(raw: string): GameRules {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new DomainError('INVALID_GAME_STATE', 'Stored rules are unreadable');
  }
  const parsed = rulesSchema.safeParse(json);
  if (!parsed.success) {
    throw new DomainError('INVALID_GAME_STATE', 'Stored rules are invalid');
  }
  if (parsed.data.initialShipmentsInTransit.length !== parsed.data.shippingDelay) {
    throw new DomainError('INVALID_GAME_STATE', 'Stored shipment pipeline does not match the delay');
  }
  if (parsed.data.demandSequence.length !== parsed.data.roundCount) {
    throw new DomainError('INVALID_GAME_STATE', 'Stored demand does not cover every round');
  }
  return parsed.data;
}
