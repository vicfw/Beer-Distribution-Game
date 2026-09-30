import { gameCodeSchema, submitOrderSchema, type ErrorBody } from '@beer-game/shared';
import { z } from 'zod';
import { leaveGame } from '../../application/game/leaveGame.js';
import {
  toPlayerSnapshot,
  toPublicPresence,
  toSpectatorSnapshot,
} from '../../application/game/projections.js';
import { submitOrder } from '../../application/game/submitOrder.js';
import type { AppDeps } from '../../application/game/deps.js';
import { hashToken } from '../../application/ids.js';
import { DomainError } from '../../domain/game/errors.js';
import type { Presence } from './presence.js';
import { publish } from './publisher.js';
import { gameRoom, playerRoom, spectatorRoom } from './rooms.js';
import type { GameServer, GameSocket } from './types.js';

const authSchema = z
  .object({
    gameCode: z.string(),
    seatToken: z.string().min(20).max(200).optional(),
    spectator: z.boolean().optional(),
    lobby: z.boolean().optional(),
  })
  .strict();

export function attachGameSockets(io: GameServer, deps: AppDeps, presence: Presence): void {
  io.use((socket, next) => {
    const parsed = authSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) {
      next(new Error('PLAYER_NOT_AUTHORIZED'));
      return;
    }
    const code = gameCodeSchema.safeParse(parsed.data.gameCode);
    if (!code.success) {
      next(new Error('GAME_NOT_FOUND'));
      return;
    }
    const game = deps.repo.findByCode(code.data);
    if (!game) {
      next(new Error('GAME_NOT_FOUND'));
      return;
    }
    if (parsed.data.spectator) {
      socket.data = { kind: 'spectator', gameId: game.id, code: game.code };
      next();
      return;
    }
    if (parsed.data.lobby && !parsed.data.seatToken) {
      socket.data = { kind: 'lobby', gameId: game.id, code: game.code };
      next();
      return;
    }
    if (!parsed.data.seatToken) {
      next(new Error('PLAYER_NOT_AUTHORIZED'));
      return;
    }
    const seated = deps.repo.findPlayerByTokenHash(hashToken(parsed.data.seatToken));
    if (!seated || seated.game.id !== game.id) {
      next(new Error('PLAYER_NOT_AUTHORIZED'));
      return;
    }
    socket.data = {
      kind: 'player',
      gameId: game.id,
      code: game.code,
      playerId: seated.player.id,
      role: seated.player.role,
    };
    next();
  });

  io.on('connection', (socket) => {
    const data = socket.data;
    if (data.kind !== 'player' && data.kind !== 'spectator' && data.kind !== 'lobby') {
      socket.disconnect(true);
      return;
    }
    socket.join(gameRoom(data.gameId));
    bindHeartbeat(socket);

    if (data.kind === 'lobby') {
      const game = deps.repo.findByCode(data.code);
      if (game) {
        socket.emit('lobby:updated', toPublicPresence(game, presence.connectedPlayerIds(game.id)));
      }
      return;
    }

    if (data.kind === 'spectator') {
      socket.join(spectatorRoom(data.gameId));
      const game = deps.repo.findByCode(data.code);
      if (game) publish(io, presence, game, []);
      bindSpectator(socket, deps, presence);
      return;
    }

    socket.join(playerRoom(data.playerId));
    const { replaced, reconnected } = presence.connect(
      data.playerId,
      data.role,
      data.gameId,
      socket,
    );
    for (const old of replaced) {
      old.emit('session:replaced', { code: data.code });
      old.disconnect(true);
    }
    const game = deps.repo.findByCode(data.code);
    if (game) publish(io, presence, game, []);
    if (reconnected) {
      io.to(gameRoom(data.gameId)).emit('player:reconnected', { role: data.role });
      deps.logger.info(
        {
          event: 'PLAYER_RECONNECTED',
          gameId: data.gameId,
          playerId: data.playerId,
          role: data.role,
        },
        'PLAYER_RECONNECTED',
      );
    }

    socket.on('round:submit-order', (payload, ack) => {
      if (typeof ack !== 'function') return;
      const parsed = submitOrderSchema.safeParse(payload);
      if (!parsed.success) {
        ack({
          ok: false,
          error: {
            code: 'INVALID_ORDER',
            message: parsed.error.issues[0]?.message ?? 'Invalid order',
          },
        });
        return;
      }
      try {
        const result = submitOrder(deps, {
          code: data.code,
          playerId: data.playerId,
          round: parsed.data.round,
          submissionId: parsed.data.submissionId,
          quantity: parsed.data.quantity,
        });
        publish(io, presence, result.game, result.events);
        ack({ ok: true, data: result.ack });
      } catch (error) {
        ack({ ok: false, error: toErrorBody(error, deps) });
      }
    });

    socket.on('game:leave', (ack) => {
      if (typeof ack !== 'function') return;
      try {
        const result = leaveGame(deps, { code: data.code, playerId: data.playerId });
        publish(io, presence, result.game, result.events);
        ack({ ok: true, data: { left: true } });
      } catch (error) {
        ack({ ok: false, error: toErrorBody(error, deps) });
      }
    });

    socket.on('game:sync', (ack) => {
      if (typeof ack !== 'function') return;
      const current = deps.repo.findByCode(data.code);
      if (!current) {
        ack({ ok: false, error: { code: 'GAME_NOT_FOUND', message: 'Game not found' } });
        return;
      }
      socket.emit(
        'game:state',
        toPlayerSnapshot(current, data.playerId, presence.connectedPlayerIds(current.id)),
      );
      ack({ ok: true, data: { version: current.version } });
    });

    socket.on('disconnect', () => {
      const { wentOffline } = presence.disconnect(data.playerId, socket.id);
      if (!wentOffline) return;
      deps.logger.info(
        {
          event: 'PLAYER_DISCONNECTED',
          gameId: data.gameId,
          playerId: data.playerId,
          role: data.role,
        },
        'PLAYER_DISCONNECTED',
      );
      io.to(gameRoom(data.gameId)).emit('player:disconnected', { role: data.role });
      const current = deps.repo.findByCode(data.code);
      if (current) publish(io, presence, current, []);
    });
  });
}

function bindHeartbeat(socket: GameSocket): void {
  socket.on('connection:ping', (ack) => {
    if (typeof ack !== 'function') return;
    ack({ ok: true, data: { alive: true } });
  });
}

function bindSpectator(socket: GameSocket, deps: AppDeps, presence: Presence): void {
  const data = socket.data;
  if (data.kind !== 'spectator') return;

  socket.on('round:submit-order', (_payload, ack) => {
    if (typeof ack !== 'function') return;
    ack({
      ok: false,
      error: { code: 'SPECTATOR_NOT_ALLOWED', message: 'Spectators cannot place orders' },
    });
  });

  socket.on('game:leave', (ack) => {
    if (typeof ack !== 'function') return;
    ack({
      ok: false,
      error: { code: 'SPECTATOR_NOT_ALLOWED', message: 'Spectators are not seated' },
    });
  });

  socket.on('game:sync', (ack) => {
    if (typeof ack !== 'function') return;
    const current = deps.repo.findByCode(data.code);
    if (!current) {
      ack({ ok: false, error: { code: 'GAME_NOT_FOUND', message: 'Game not found' } });
      return;
    }
    socket.emit(
      'game:state',
      toSpectatorSnapshot(current, presence.connectedPlayerIds(current.id)),
    );
    ack({ ok: true, data: { version: current.version } });
  });
}

function toErrorBody(error: unknown, deps: AppDeps): ErrorBody {
  if (error instanceof DomainError) return { code: error.code, message: error.message };
  deps.logger.error({ err: error }, 'socket command failed');
  return { code: 'INTERNAL', message: 'Something went wrong' };
}
