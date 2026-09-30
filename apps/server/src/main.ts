import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serveStatic } from '@hono/node-server/serve-static';
import { getRequestListener } from '@hono/node-server';
import { Server } from 'socket.io';
import type { AppDeps } from './application/game/deps.js';
import type { RealtimePort } from './application/realtime.js';
import { loadConfig, type AppConfig } from './config.js';
import { openDatabase } from './infrastructure/database/client.js';
import { GameRepository } from './infrastructure/database/GameRepository.js';
import { createLogger } from './infrastructure/logging/logger.js';
import { Presence } from './infrastructure/realtime/presence.js';
import { publish } from './infrastructure/realtime/publisher.js';
import { attachGameSockets } from './infrastructure/realtime/socketServer.js';
import type { GameServer } from './infrastructure/realtime/types.js';
import { createApp } from './http/app.js';

export type RunningServer = {
  port: number;
  close: () => Promise<void>;
};

export async function start(config: AppConfig = loadConfig()): Promise<RunningServer> {
  const logger = createLogger(config.LOG_LEVEL);
  const { sqlite, db } = openDatabase(config.DATABASE_PATH);
  const repo = new GameRepository(sqlite, db);
  const deps: AppDeps = {
    repo,
    logger,
    now: () => new Date().toISOString(),
  };
  const presence = new Presence();
  const holder: { io: GameServer | null } = { io: null };
  const realtime: RealtimePort = {
    publish: (game, events) => {
      if (holder.io) publish(holder.io, presence, game, events);
    },
    connectedPlayerIds: (gameId) => presence.connectedPlayerIds(gameId),
  };
  const app = createApp({ ...deps, realtime });
  if (config.STATIC_DIR) mountStatic(app, config.STATIC_DIR);

  const httpServer: HttpServer = createServer(getRequestListener(app.fetch));
  const io: GameServer = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 100_000,
    pingInterval: 15_000,
    pingTimeout: 20_000,
  });
  holder.io = io;
  attachGameSockets(io, deps, presence);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.PORT, config.HOST, () => resolve());
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? (address as AddressInfo).port : config.PORT;
  logger.info({ event: 'LISTENING', port }, 'LISTENING');

  let closed = false;
  const close = () =>
    new Promise<void>((resolve) => {
      if (closed) {
        resolve();
        return;
      }
      closed = true;
      io.close();
      httpServer.closeAllConnections();
      httpServer.close(() => {
        sqlite.pragma('wal_checkpoint(TRUNCATE)');
        sqlite.close();
        resolve();
      });
    });

  if (config.PORT !== 0) {
    const shutdown = () => {
      logger.info({ event: 'SHUTDOWN' }, 'SHUTDOWN');
      void close().finally(() => process.exit(0));
      setTimeout(() => process.exit(1), 5_000).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }

  return { port, close };
}

function mountStatic(app: ReturnType<typeof createApp>, root: string): void {
  app.use('/assets/*', serveStatic({ root }));
  app.get('/favicon.svg', serveStatic({ root, path: 'favicon.svg' }));
  app.get('/', serveStatic({ root, path: 'index.html' }));
  app.get('/game/*', serveStatic({ root, path: 'index.html' }));
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('main.ts') || entry.endsWith('index.js') || entry.endsWith('main.js')) {
  start().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
