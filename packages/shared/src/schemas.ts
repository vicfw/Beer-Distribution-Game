import { z } from 'zod';
import { ROLES } from './roles.js';

export const MAX_ORDER_QUANTITY = 10_000;

export const createGameSchema = z
  .object({
    holdingCost: z.number().finite().nonnegative().max(1_000).optional(),
    backlogCost: z.number().finite().nonnegative().max(1_000).optional(),
    shippingDelay: z.number().int().min(1).max(8).optional(),
    initialInventory: z.number().int().nonnegative().max(100_000).optional(),
    initialBacklog: z.number().int().nonnegative().max(100_000).optional(),
    roundCount: z.number().int().min(1).max(52).optional(),
    demandSequence: z.array(z.number().int().nonnegative().max(100_000)).min(1).max(52).optional(),
  })
  .strict();

export const joinGameSchema = z
  .object({
    role: z.enum(ROLES),
  })
  .strict();

export const submitOrderSchema = z
  .object({
    round: z.number().int().positive(),
    submissionId: z.string().uuid(),
    quantity: z.number().int().min(0).max(MAX_ORDER_QUANTITY),
  })
  .strict();

export const gameCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z2-9]{6}$/));
