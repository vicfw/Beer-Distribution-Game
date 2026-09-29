import { randomUUID } from 'node:crypto';
import { ROLES } from '@beer-game/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../infrastructure/database/client.js';
import { GameRepository } from '../../infrastructure/database/GameRepository.js';
import { captureLogger } from '../../infrastructure/logging/logger.js';
import { createGame } from './createGame.js';
import type { AppDeps } from './deps.js';
import { joinGame } from './joinGame.js';
import { toPlayerSnapshot, toSpectatorSnapshot } from './projections.js';
import { submitOrder } from './submitOrder.js';

const NOW = '2026-01-01T00:00:00.000Z';

function setup() {
  const opened = openDatabase(':memory:');
  const logger = captureLogger();
  const deps: AppDeps = {
    repo: new GameRepository(opened.sqlite, opened.db),
    logger,
    now: () => NOW,
  };
  return { deps, logger, close: () => opened.sqlite.close() };
}

function seatEveryone(deps: AppDeps, code: string) {
  return ROLES.map((role) => joinGame(deps, { code, role }).response);
}

describe('order submission', () => {
  it('advances exactly once when the four orders arrive together', async () => {
    const { deps, close } = setup();
    const { code } = createGame(deps, {});
    const seats = seatEveryone(deps, code);
    const before = deps.repo.findByCode(code);
    await Promise.all(
      seats.map((seat, index) =>
        Promise.resolve().then(() =>
          submitOrder(deps, {
            code,
            playerId: seat.playerId,
            round: 1,
            submissionId: randomUUID(),
            quantity: 3 + index,
          }),
        ),
      ),
    );
    const after = deps.repo.findByCode(code);
    expect(after?.state.round).toBe(2);
    expect(after?.state.history).toHaveLength(1);
    expect(after?.state.pendingOrders).toEqual({});
    expect(after?.version).toBe((before?.version ?? 0) + 4);
    close();
  });

  it('treats a repeated submission id as the original order', () => {
    const { deps, close } = setup();
    const { code } = createGame(deps, {});
    const [retailer] = seatEveryone(deps, code);
    if (!retailer) throw new Error('missing retailer');
    const submissionId = randomUUID();
    const first = submitOrder(deps, { code, playerId: retailer.playerId, round: 1, submissionId, quantity: 6 });
    const version = deps.repo.findByCode(code)?.version;
    const second = submitOrder(deps, { code, playerId: retailer.playerId, round: 1, submissionId, quantity: 6 });
    expect(first.ack.duplicate).toBe(false);
    expect(second.ack).toMatchObject({ duplicate: true, quantity: 6, round: 1 });
    expect(deps.repo.findByCode(code)?.version).toBe(version);
    expect(deps.repo.findByCode(code)?.state.pendingOrders.retailer).toBe(6);
    expect(() =>
      submitOrder(deps, { code, playerId: retailer.playerId, round: 1, submissionId: randomUUID(), quantity: 1 }),
    ).toThrowError(expect.objectContaining({ code: 'ALREADY_SUBMITTED' }));
    close();
  });

  it('rejects an order for a round that is not active and an unknown player', () => {
    const { deps, close } = setup();
    const { code } = createGame(deps, {});
    const [retailer] = seatEveryone(deps, code);
    if (!retailer) throw new Error('missing retailer');
    expect(() =>
      submitOrder(deps, { code, playerId: retailer.playerId, round: 9, submissionId: randomUUID(), quantity: 1 }),
    ).toThrowError(expect.objectContaining({ code: 'ROUND_NOT_ACTIVE' }));
    expect(() =>
      submitOrder(deps, { code, playerId: randomUUID(), round: 1, submissionId: randomUUID(), quantity: 1 }),
    ).toThrowError(expect.objectContaining({ code: 'PLAYER_NOT_AUTHORIZED' }));
    close();
  });
});

describe('privacy projections', () => {
  it('hides other roles numbers and the future demand from a player and a spectator', () => {
    const { deps, close } = setup();
    const { code } = createGame(deps, {});
    const seats = seatEveryone(deps, code);
    const wholesaler = seats.find((seat) => seat.role === 'wholesaler');
    const retailer = seats.find((seat) => seat.role === 'retailer');
    if (!wholesaler || !retailer) throw new Error('missing seats');
    submitOrder(deps, { code, playerId: wholesaler.playerId, round: 1, submissionId: randomUUID(), quantity: 17 });
    const game = deps.repo.findByCode(code);
    if (!game) throw new Error('missing game');

    const playerView = toPlayerSnapshot(game, retailer.playerId, new Set());
    const spectatorView = toSpectatorSnapshot(game, new Set());
    expect(collectNumbers(playerView)).not.toContain(17);
    expect(collectNumbers(spectatorView)).not.toContain(17);
    expect(JSON.stringify(playerView)).not.toContain('demandSequence');
    expect(spectatorView.debrief).toBeNull();
    expect(playerView.seats.find((seat) => seat.role === 'wholesaler')?.submitted).toBe(true);
    expect(playerView.history).toEqual([]);
    close();
  });
});

function collectNumbers(value: unknown, acc: number[] = []): number[] {
  if (typeof value === 'number') acc.push(value);
  else if (Array.isArray(value)) for (const item of value) collectNumbers(item, acc);
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectNumbers(item, acc);
  }
  return acc;
}
