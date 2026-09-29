import { gameCodeSchema, createGameSchema, joinGameSchema } from '@beer-game/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createGame } from '../application/game/createGame.js';
import type { AppDeps } from '../application/game/deps.js';
import { joinGame } from '../application/game/joinGame.js';
import { leaveGame } from '../application/game/leaveGame.js';
import { getDebrief, getLobby, playerForToken } from '../application/game/queries.js';
import { toLobby } from '../application/game/projections.js';
import { newId } from '../application/ids.js';
import type { RealtimePort } from '../application/realtime.js';
import { DomainError } from '../domain/game/errors.js';
import { httpError } from './errorMapper.js';

export type HttpDeps = AppDeps & { realtime: RealtimePort };

export function createApp(deps: HttpDeps) {
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: (origin) => origin,
      credentials: true,
    }),
  );

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? newId();
    const started = Date.now();
    c.header('x-request-id', requestId);
    c.header('x-content-type-options', 'nosniff');
    try {
      await next();
    } finally {
      deps.logger.info(
        {
          requestId,
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          ms: Date.now() - started,
        },
        'http',
      );
    }
  });

  app.onError((error, c) => httpError(error, c, (cause) => deps.logger.error({ err: cause, path: c.req.path }, 'request failed')));

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/ready', (c) => {
    try {
      if (!deps.repo.ready()) return c.json({ status: 'not-ready' }, 503);
      return c.json({ status: 'ready' });
    } catch (error) {
      deps.logger.error({ err: error }, 'readiness check failed');
      return c.json({ status: 'not-ready' }, 503);
    }
  });

  app.post('/api/games', async (c) => {
    const input = createGameSchema.parse(await readJson(c));
    const created = createGame(deps, input);
    return c.json(created, 201);
  });

  app.get('/api/games/:code', (c) => {
    const code = parseCode(c.req.param('code'));
    return c.json(getLobby(deps, deps.realtime, code));
  });

  app.post('/api/games/:code/seats', async (c) => {
    const code = parseCode(c.req.param('code'));
    const body = joinGameSchema.parse(await readJson(c));
    const result = joinGame(deps, { code, role: body.role });
    deps.realtime.publish(result.game, result.events);
    return c.json(
      {
        ...result.response,
        game: toLobby(result.game, deps.realtime.connectedPlayerIds(result.game.id)),
      },
      201,
    );
  });

  app.delete('/api/games/:code/seats', (c) => {
    const code = parseCode(c.req.param('code'));
    const token = bearerToken(c.req.header('authorization'));
    const seated = playerForToken(deps, token);
    if (seated.game.code !== code) {
      throw new DomainError('PLAYER_NOT_AUTHORIZED', 'Seat token is not valid for this game');
    }
    const result = leaveGame(deps, { code, playerId: seated.player.id });
    deps.realtime.publish(result.game, result.events);
    return c.json({ left: true });
  });

  app.get('/api/games/:code/results', (c) => {
    const code = parseCode(c.req.param('code'));
    return c.json(getDebrief(deps, code));
  });

  app.get('/api/games/:code/history', (c) => {
    const code = parseCode(c.req.param('code'));
    return c.json(getDebrief(deps, code));
  });

  app.notFound((c) => c.json({ error: { code: 'GAME_NOT_FOUND', message: 'Not found' } }, 404));

  return app;
}

async function readJson(c: { req: { text: () => Promise<string> } }): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') return {};
  return JSON.parse(text) as unknown;
}

function parseCode(raw: string | undefined): string {
  const parsed = gameCodeSchema.safeParse(raw ?? '');
  if (!parsed.success) throw new DomainError('GAME_NOT_FOUND', 'Game not found');
  return parsed.data;
}

function bearerToken(header: string | undefined): string {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  const token = match?.[1];
  if (!token) throw new DomainError('PLAYER_NOT_AUTHORIZED', 'Seat token is missing');
  return token;
}
