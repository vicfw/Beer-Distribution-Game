import type { ErrorCode } from '@beer-game/shared';
import type { Context } from 'hono';
import { ZodError } from 'zod';
import { DomainError } from '../domain/game/errors.js';

const STATUS: Record<ErrorCode, 400 | 403 | 404 | 409 | 422 | 500> = {
  GAME_NOT_FOUND: 404,
  GAME_ALREADY_STARTED: 409,
  ROLE_ALREADY_TAKEN: 409,
  INVALID_ORDER: 422,
  INVALID_RULES: 422,
  ROUND_NOT_ACTIVE: 409,
  ALREADY_SUBMITTED: 409,
  PLAYER_NOT_AUTHORIZED: 403,
  INVALID_GAME_STATE: 409,
  SPECTATOR_NOT_ALLOWED: 403,
  GAME_FINISHED: 409,
  INTERNAL: 500,
};

function errorBody(code: ErrorCode, message: string) {
  return { error: { code, message } };
}

export function httpError(error: unknown, c: Context, log: (error: unknown) => void) {
  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? 'Invalid input';
    return c.json(errorBody('INVALID_RULES', message), 422);
  }
  if (error instanceof SyntaxError) {
    return c.json(errorBody('INVALID_RULES', 'Request body must be JSON'), 422);
  }
  if (error instanceof DomainError) {
    return c.json(errorBody(error.code, error.message), STATUS[error.code]);
  }
  log(error);
  return c.json(errorBody('INTERNAL', 'Something went wrong'), 500);
}
