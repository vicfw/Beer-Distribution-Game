import type { CreateGameInput } from '@beer-game/shared';
import { DomainError } from '../../domain/game/errors.js';
import { normalizeRules } from '../../domain/game/gameRules.js';
import { DuplicateCodeError } from '../../infrastructure/database/sqliteErrors.js';
import type { AppDeps } from './deps.js';
import { newCode, newId } from '../ids.js';

export function createGame(deps: AppDeps, input: CreateGameInput): { code: string; gameId: string } {
  const rules = normalizeRules(input);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    try {
      const game = deps.repo.create({ id: newId(), code, rules, now: deps.now() });
      deps.logger.info({ event: 'GAME_CREATED', gameId: game.id, code }, 'GAME_CREATED');
      return { code: game.code, gameId: game.id };
    } catch (error) {
      if (!(error instanceof DuplicateCodeError)) throw error;
    }
  }
  throw new DomainError('INVALID_GAME_STATE', 'Could not allocate a game code');
}
