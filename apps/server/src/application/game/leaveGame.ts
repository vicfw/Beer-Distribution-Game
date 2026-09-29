import { releaseRole } from '../../domain/game/GameEngine.js';
import { DomainError } from '../../domain/game/errors.js';
import type { GameRecord } from '../../infrastructure/database/GameRepository.js';
import type { GameEvent } from '../realtime.js';
import type { AppDeps } from './deps.js';

export function leaveGame(
  deps: AppDeps,
  input: { code: string; playerId: string },
): { game: GameRecord; events: GameEvent[] } {
  const { game } = deps.repo.withGame(input.code, deps.now(), (current) => {
    const player = current.players.find((candidate) => candidate.id === input.playerId);
    if (!player) throw new DomainError('PLAYER_NOT_AUTHORIZED', 'You are not seated in this game');
    if (current.state.status !== 'lobby') {
      throw new DomainError('INVALID_GAME_STATE', 'You can only leave while the game is in the lobby');
    }
    return {
      commit: {
        next: {
          ...current,
          state: releaseRole(current.state, player.role),
          players: current.players.filter((candidate) => candidate.id !== player.id),
        },
        orders: [],
      },
      value: true,
    };
  });
  deps.logger.info({ event: 'PLAYER_LEFT', gameId: game.id, playerId: input.playerId, code: game.code }, 'PLAYER_LEFT');
  return { game, events: ['left'] };
}
