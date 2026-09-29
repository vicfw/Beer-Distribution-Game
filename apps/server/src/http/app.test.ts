import { randomUUID } from 'node:crypto';
import { ROLES } from '@beer-game/shared';
import { describe, expect, it } from 'vitest';
import type { AppDeps } from '../application/game/deps.js';
import { submitOrder } from '../application/game/submitOrder.js';
import { noopRealtime } from '../application/realtime.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../infrastructure/database/client.js';
import { GameRepository } from '../infrastructure/database/GameRepository.js';
import { captureLogger } from '../infrastructure/logging/logger.js';
import { createApp } from './app.js';

function setup() {
  const opened = openDatabase(':memory:');
  const logger = captureLogger();
  const deps: AppDeps = {
    repo: new GameRepository(opened.sqlite, opened.db),
    logger,
    now: () => '2026-01-01T00:00:00.000Z',
  };
  const app = createApp({ ...deps, realtime: noopRealtime });
  return { app, deps, logger, close: () => opened.sqlite.close() };
}

describe('http', () => {
  it('reports health and readiness', async () => {
    const { app, close } = setup();
    expect((await app.request('/health')).status).toBe(200);
    expect((await app.request('/ready')).status).toBe(200);
    expect((await app.request('/missing')).status).toBe(404);
    close();
  });

  it('creates a game, seats four players, and refuses client-owned state', async () => {
    const { app, deps, logger, close } = setup();
    const rejected = await app.request('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inventory: 99, backlog: 0 }),
    });
    expect(rejected.status).toBe(422);

    const created = await app.request('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(created.status).toBe(201);
    const { code } = (await created.json()) as { code: string };
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(logger.events.some((event) => event.event === 'GAME_CREATED')).toBe(true);

    let lastStatus = '';
    let retailerToken = '';
    const retailer = await app.request(`/api/games/${code}/seats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'retailer' }),
    });
    expect(retailer.status).toBe(201);
    retailerToken = ((await retailer.json()) as { seatToken: string }).seatToken;

    const taken = await app.request(`/api/games/${code}/seats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'retailer' }),
    });
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: { code: string } }).error.code).toBe('ROLE_ALREADY_TAKEN');

    for (const role of ROLES) {
      if (role === 'retailer') continue;
      const response = await app.request(`/api/games/${code}/seats`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      expect(response.status).toBe(201);
      lastStatus = ((await response.json()) as { game: { status: string } }).game.status;
    }
    expect(lastStatus).toBe('playing');

    const again = await app.request(`/api/games/${code}/seats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'retailer' }),
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('GAME_ALREADY_STARTED');

    const early = await app.request(`/api/games/${code}/results`);
    expect(early.status).toBe(409);

    const leaving = await app.request(`/api/games/${code}/seats`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${retailerToken}` },
    });
    expect(leaving.status).toBe(409);

    const seats = deps.repo.findByCode(code)?.players ?? [];
    for (let round = 1; round <= 20; round += 1) {
      for (const player of seats) {
        submitOrder(deps, { code, playerId: player.id, round, submissionId: randomUUID(), quantity: 4 });
      }
    }
    const results = await app.request(`/api/games/${code}/history`);
    expect(results.status).toBe(200);
    const debrief = (await results.json()) as { totalCostCents: number; rounds: unknown[] };
    expect(debrief.totalCostCents).toBe(75400);
    expect(debrief.rounds).toHaveLength(20);
    close();
  });
});

describe('config', () => {
  it('defaults the port and rejects a bad log level', () => {
    expect(loadConfig({}).PORT).toBe(3001);
    expect(loadConfig({ PORT: '4100' }).PORT).toBe(4100);
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });
});
