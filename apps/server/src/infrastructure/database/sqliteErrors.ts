import Database from 'better-sqlite3';
import { DomainError } from '../../domain/game/errors.js';

export class DuplicateCodeError extends Error {
  constructor() {
    super('Game code already exists');
    this.name = 'DuplicateCodeError';
  }
}

export function translateSqliteError(error: unknown): unknown {
  if (!(error instanceof Database.SqliteError)) return error;
  if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') return error;
  const detail = error.message;
  if (detail.includes('players.game_id') || detail.includes('players.role')) {
    return new DomainError('ROLE_ALREADY_TAKEN', 'That role is already taken');
  }
  if (detail.includes('orders.game_id') || detail.includes('orders.round_number')) {
    return new DomainError('ALREADY_SUBMITTED', 'An order was already submitted for this role this round');
  }
  if (detail.includes('games.code')) {
    return new DuplicateCodeError();
  }
  return new DomainError('INVALID_GAME_STATE', 'That action conflicted with another player');
}
