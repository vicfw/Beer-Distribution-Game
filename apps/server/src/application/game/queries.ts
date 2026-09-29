import type { Debrief, LobbyResponse } from '@beer-game/shared';
import { DomainError } from '../../domain/game/errors.js';
import { hashToken } from '../ids.js';
import type { RealtimePort } from '../realtime.js';
import type { AppDeps } from './deps.js';
import { toLobby } from './projections.js';

export function getLobby(deps: AppDeps, realtime: RealtimePort, code: string): LobbyResponse {
  const game = deps.repo.findByCode(code);
  if (!game) throw new DomainError('GAME_NOT_FOUND', 'Game not found');
  return toLobby(game, realtime.connectedPlayerIds(game.id));
}

export function getDebrief(deps: AppDeps, code: string): Debrief {
  const game = deps.repo.findByCode(code);
  if (!game) throw new DomainError('GAME_NOT_FOUND', 'Game not found');
  if (game.state.status !== 'finished') {
    throw new DomainError('INVALID_GAME_STATE', 'Results are available after the game ends');
  }
  const debrief = deps.repo.loadDebrief(game.id);
  if (!debrief) throw new DomainError('INVALID_GAME_STATE', 'Results have not been recorded');
  return debrief;
}

export function playerForToken(deps: AppDeps, token: string) {
  const found = deps.repo.findPlayerByTokenHash(hashToken(token));
  if (!found) throw new DomainError('PLAYER_NOT_AUTHORIZED', 'Seat token is not valid');
  return found;
}
