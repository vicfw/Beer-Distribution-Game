import type { SubmitOrderAck } from '@beer-game/shared';
import { isRoundComplete, processRound, submitOrder as placeOrder } from '../../domain/game/GameEngine.js';
import { DomainError } from '../../domain/game/errors.js';
import type { GameRecord } from '../../infrastructure/database/GameRepository.js';
import { newId } from '../ids.js';
import type { GameEvent } from '../realtime.js';
import type { AppDeps } from './deps.js';

export function submitOrder(
  deps: AppDeps,
  input: { code: string; playerId: string; round: number; submissionId: string; quantity: number },
): { game: GameRecord; ack: SubmitOrderAck; events: GameEvent[] } {
  const now = deps.now();
  const orderId = newId();
  const { game, value } = deps.repo.withGame(input.code, now, (current, lookup) => {
    const player = current.players.find((candidate) => candidate.id === input.playerId);
    if (!player) throw new DomainError('PLAYER_NOT_AUTHORIZED', 'You are not seated in this game');

    const existing = lookup.findBySubmissionId(input.submissionId);
    if (existing) {
      if (existing.playerId !== player.id || existing.gameId !== current.id) {
        throw new DomainError('PLAYER_NOT_AUTHORIZED', 'That submission belongs to someone else');
      }
      return {
        commit: null,
        value: {
          duplicate: true,
          advanced: false,
          round: existing.roundNumber,
          quantity: existing.quantity,
          events: [] as GameEvent[],
        },
      };
    }

    if (current.state.status === 'finished') throw new DomainError('GAME_FINISHED', 'The game is over');
    if (current.state.status !== 'playing') {
      throw new DomainError('ROUND_NOT_ACTIVE', 'The round is not accepting orders');
    }
    if (input.round !== current.state.round) {
      throw new DomainError('ROUND_NOT_ACTIVE', 'That round is no longer accepting orders');
    }

    let state = placeOrder(current.state, player.role, input.quantity);
    const events: GameEvent[] = ['order'];
    let advanced = false;
    if (isRoundComplete(state)) {
      state = processRound(state);
      advanced = true;
      events.push('completed');
      if (state.status === 'finished') events.push('finished');
      else events.push('round-started');
    }

    return {
      commit: {
        next: { ...current, state },
        orders: [
          {
            id: orderId,
            playerId: player.id,
            role: player.role,
            round: input.round,
            quantity: input.quantity,
            submissionId: input.submissionId,
          },
        ],
      },
      value: { duplicate: false, advanced, round: input.round, quantity: input.quantity, events },
    };
  });

  if (!value.duplicate) {
    const role = game.players.find((player) => player.id === input.playerId)?.role;
    deps.logger.info(
      { event: 'ORDER_SUBMITTED', gameId: game.id, playerId: input.playerId, role, round: value.round, code: game.code },
      'ORDER_SUBMITTED',
    );
    if (value.events.includes('completed')) {
      const completedRound = game.state.status === 'finished' ? game.state.round : game.state.round - 1;
      deps.logger.info(
        { event: 'ROUND_COMPLETED', gameId: game.id, round: completedRound, code: game.code },
        'ROUND_COMPLETED',
      );
    }
    if (value.events.includes('round-started')) {
      deps.logger.info(
        { event: 'ROUND_STARTED', gameId: game.id, round: game.state.round, code: game.code },
        'ROUND_STARTED',
      );
    }
    if (value.events.includes('finished')) {
      deps.logger.info({ event: 'GAME_FINISHED', gameId: game.id, code: game.code }, 'GAME_FINISHED');
    }
  }

  return {
    game,
    events: value.events,
    ack: {
      duplicate: value.duplicate,
      advanced: value.advanced,
      round: value.round,
      quantity: value.quantity,
    },
  };
}
