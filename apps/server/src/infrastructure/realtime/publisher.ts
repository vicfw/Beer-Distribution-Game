import { ROLES } from '@beer-game/shared';
import type { GameEvent } from '../../application/realtime.js';
import type { GameRecord } from '../database/GameRepository.js';
import {
  toPlayerSnapshot,
  toPublicPresence,
  toSpectatorSnapshot,
} from '../../application/game/projections.js';
import type { Presence } from './presence.js';
import { gameRoom, playerRoom, spectatorRoom } from './rooms.js';
import type { GameServer } from './types.js';

export function publish(
  io: GameServer,
  presence: Presence,
  game: GameRecord,
  events: readonly GameEvent[],
): void {
  const connected = presence.connectedPlayerIds(game.id);
  for (const player of game.players) {
    io.to(playerRoom(player.id)).emit('game:state', toPlayerSnapshot(game, player.id, connected));
  }
  io.to(spectatorRoom(game.id)).emit('game:state', toSpectatorSnapshot(game, connected));
  io.to(gameRoom(game.id)).emit('lobby:updated', toPublicPresence(game, connected));

  const room = gameRoom(game.id);
  if (events.includes('started')) {
    io.to(room).emit('game:started', { version: game.version, round: game.state.round });
  }
  if (events.includes('round-started')) {
    io.to(room).emit('round:started', { version: game.version, round: game.state.round });
  }
  if (events.includes('order') && !events.includes('completed')) {
    io.to(room).emit('round:updated', {
      version: game.version,
      round: game.state.round,
      submitted: ROLES.filter((role) => game.state.pendingOrders[role] !== undefined),
    });
  }
  if (events.includes('completed')) {
    const round = game.state.status === 'finished' ? game.state.round : game.state.round - 1;
    io.to(room).emit('round:completed', { version: game.version, round });
  }
  if (events.includes('finished')) {
    io.to(room).emit('game:finished', { version: game.version });
  }
}
