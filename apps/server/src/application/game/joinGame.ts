import { ROLES, type JoinGameResponse, type Role } from '@beer-game/shared';
import { claimRole, startGame } from '../../domain/game/GameEngine.js';
import type { GameRecord, PlayerRecord } from '../../infrastructure/database/GameRepository.js';
import { hashToken, newId, newSeatToken } from '../ids.js';
import type { GameEvent } from '../realtime.js';
import type { AppDeps } from './deps.js';
import { toLobby } from './projections.js';

export function joinGame(
  deps: AppDeps,
  input: { code: string; role: Role },
): { response: JoinGameResponse; game: GameRecord; events: GameEvent[] } {
  const token = newSeatToken();
  const tokenHash = hashToken(token);
  const playerId = newId();
  const now = deps.now();

  const { game, value } = deps.repo.withGame(input.code, now, (current) => {
    const claimed = claimRole(current.state, input.role);
    const player: PlayerRecord = {
      id: playerId,
      gameId: current.id,
      role: input.role,
      tokenHash,
      createdAt: now,
      updatedAt: now,
    };
    let next: GameRecord = { ...current, state: claimed, players: [...current.players, player] };
    let started = false;
    if (ROLES.every((role) => next.state.seats[role])) {
      next = { ...next, state: startGame(claimed) };
      started = true;
    }
    return { commit: { next, orders: [] }, value: { started } };
  });

  deps.logger.info(
    { event: 'PLAYER_JOINED', gameId: game.id, playerId, role: input.role, code: game.code },
    'PLAYER_JOINED',
  );
  const events: GameEvent[] = [];
  if (value.started) {
    deps.logger.info({ event: 'GAME_STARTED', gameId: game.id, code: game.code }, 'GAME_STARTED');
    deps.logger.info(
      { event: 'ROUND_STARTED', gameId: game.id, round: game.state.round, code: game.code },
      'ROUND_STARTED',
    );
    events.push('started', 'round-started');
  }

  return {
    game,
    events,
    response: {
      playerId,
      role: input.role,
      seatToken: token,
      game: toLobby(game, new Set()),
    },
  };
}
