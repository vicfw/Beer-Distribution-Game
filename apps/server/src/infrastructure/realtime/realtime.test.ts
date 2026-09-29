import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROLES, type Ack, type ClientToServerEvents, type GameSnapshot, type PlayerSnapshot, type ServerToClientEvents, type SubmitOrderAck } from '@beer-game/shared';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config.js';
import { start, type RunningServer } from '../../main.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const openSockets: Client[] = [];
let running: RunningServer | undefined;

afterEach(async () => {
  for (const socket of openSockets) socket.disconnect();
  openSockets.splice(0);
  if (running) {
    await running.close();
    running = undefined;
  }
});

describe('realtime game', () => {
  it('plays a round, hides other orders, and survives refresh, duplicates, and a restart', async () => {
    const file = tempFile();
    running = await start(testConfig(file));
    const port = running.port;
    const code = await createGame(port);
    const seats = [];
    for (const role of ROLES) seats.push(await claimSeat(port, code, role));

    const players = seats.map((seat) => connectPlayer(port, code, seat.seatToken));
    const snapshots = await Promise.all(players.map((player) => player.ready));
    expect(snapshots.every((snapshot) => snapshot.status === 'playing' && snapshot.round === 1)).toBe(true);

    const retailer = players[0];
    const wholesaler = players[1];
    if (!retailer || !wholesaler || !seats[0] || !seats[1]) throw new Error('missing players');
    const seen: unknown[] = [];
    retailer.socket.onAny((event, payload) => seen.push({ event, payload }));

    const retailerState = waitForPlayer(retailer.socket, (snapshot) => snapshot.seats.some((seat) => seat.role === 'wholesaler' && seat.submitted));
    const ack = await emitOrder(wholesaler.socket, { round: 1, submissionId: randomUUID(), quantity: 17 });
    expect(ack.ok).toBe(true);
    await retailerState;
    expect(collectNumbers(seen)).not.toContain(17);

    const rejected = await wholesaler.socket.timeout(2000).emitWithAck('round:submit-order', {
      round: 1,
      submissionId: randomUUID(),
      quantity: 4,
      inventory: 12,
    } as never);
    expect(rejected.ok).toBe(false);

    const submissionId = randomUUID();
    const first = await emitOrder(retailer.socket, { round: 1, submissionId, quantity: 5 });
    const second = await emitOrder(retailer.socket, { round: 1, submissionId, quantity: 5 });
    expect(first.ok && first.data.duplicate).toBe(false);
    expect(second.ok && second.data.duplicate).toBe(true);

    retailer.socket.disconnect();
    const refreshed = connectPlayer(port, code, seats[0].seatToken);
    const afterRefresh = await refreshed.ready;
    expect(afterRefresh.you.role).toBe('retailer');
    expect(afterRefresh.station?.submittedQuantity).toBe(5);
    expect(afterRefresh.version).toBeGreaterThanOrEqual(snapshots[0]?.version ?? 0);

    const spectator = connectSpectator(port, code);
    const spectatorView = await spectator.ready;
    expect(spectatorView.kind).toBe('spectator');
    expect(spectatorView.debrief).toBeNull();
    const spectatorAck = await spectator.socket.timeout(2000).emitWithAck('round:submit-order', {
      round: 1,
      submissionId: randomUUID(),
      quantity: 1,
    });
    expect(spectatorAck.ok).toBe(false);
    if (!spectatorAck.ok) expect(spectatorAck.error.code).toBe('SPECTATOR_NOT_ALLOWED');

    const replaced = onceReplaced(refreshed.socket);
    const thief = connectPlayer(port, code, seats[0].seatToken);
    await thief.ready;
    expect((await replaced).code).toBe(code);
    expect(refreshed.socket.disconnected).toBe(true);

    await running.close();
    running = undefined;
    for (const socket of openSockets) socket.disconnect();
    openSockets.splice(0);

    running = await start(testConfig(file));
    const restored = connectPlayer(running.port, code, seats[0].seatToken);
    const restoredView = await restored.ready;
    expect(restoredView.you.role).toBe('retailer');
    expect(restoredView.station?.submittedQuantity).toBe(5);
    expect(restoredView.round).toBe(1);
  }, 20_000);

  it('processes one round when the last orders arrive together', async () => {
    running = await start(testConfig(tempFile()));
    const code = await createGame(running.port);
    const seats = [];
    for (const role of ROLES) seats.push(await claimSeat(running.port, code, role));
    const players = seats.map((seat) => connectPlayer(running?.port ?? 0, code, seat.seatToken));
    await Promise.all(players.map((player) => player.ready));
    const pending = players.map((player, index) => {
      const socket = player.socket;
      const next = waitForPlayer(socket, (snapshot) => snapshot.round === 2);
      const order = emitOrder(socket, { round: 1, submissionId: randomUUID(), quantity: index + 1 });
      return Promise.all([order, next]);
    });
    const results = await Promise.all(pending);
    for (const [ack, snapshot] of results) {
      expect(ack.ok).toBe(true);
      expect(snapshot.round).toBe(2);
      expect(snapshot.history).toHaveLength(1);
    }
  }, 20_000);
});

function testConfig(file: string): AppConfig {
  return {
    PORT: 0,
    HOST: '127.0.0.1',
    DATABASE_PATH: file,
    LOG_LEVEL: 'silent',
    STATIC_DIR: undefined,
  };
}

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'beer-live-')), 'game.sqlite');
}

async function createGame(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/api/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const body = (await response.json()) as { code: string };
  return body.code;
}

async function claimSeat(port: number, code: string, role: (typeof ROLES)[number]) {
  const response = await fetch(`http://127.0.0.1:${port}/api/games/${code}/seats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  return (await response.json()) as { playerId: string; role: string; seatToken: string };
}

function connectPlayer(port: number, code: string, seatToken: string) {
  const socket = io(`http://127.0.0.1:${port}`, {
    auth: { gameCode: code, seatToken },
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
  }) as Client;
  openSockets.push(socket);
  return { socket, ready: firstPlayerSnapshot(socket) };
}

function connectSpectator(port: number, code: string) {
  const socket = io(`http://127.0.0.1:${port}`, {
    auth: { gameCode: code, spectator: true },
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
  }) as Client;
  openSockets.push(socket);
  const ready = new Promise<Extract<GameSnapshot, { kind: 'spectator' }>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('spectator timeout')), 4000);
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('game:state', (snapshot) => {
      if (snapshot.kind !== 'spectator') return;
      clearTimeout(timer);
      socket.off('game:state');
      resolve(snapshot);
    });
  });
  return { socket, ready };
}

function firstPlayerSnapshot(socket: Client): Promise<PlayerSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('player timeout')), 4000);
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('game:state', (snapshot) => {
      if (snapshot.kind !== 'player') return;
      clearTimeout(timer);
      socket.off('game:state');
      resolve(snapshot);
    });
  });
}

function waitForPlayer(socket: Client, predicate: (snapshot: PlayerSnapshot) => boolean): Promise<PlayerSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('snapshot timeout')), 4000);
    const onState = (snapshot: GameSnapshot) => {
      if (snapshot.kind !== 'player' || !predicate(snapshot)) return;
      clearTimeout(timer);
      socket.off('game:state', onState);
      resolve(snapshot);
    };
    socket.on('game:state', onState);
  });
}

function onceReplaced(socket: Client): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout session:replaced')), 4000);
    socket.once('session:replaced', (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function emitOrder(
  socket: Client,
  payload: { round: number; submissionId: string; quantity: number },
): Promise<Ack<SubmitOrderAck>> {
  return socket.timeout(2000).emitWithAck('round:submit-order', payload);
}

function collectNumbers(value: unknown, acc: number[] = []): number[] {
  if (typeof value === 'number') acc.push(value);
  else if (Array.isArray(value)) for (const item of value) collectNumbers(item, acc);
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectNumbers(item, acc);
  }
  return acc;
}
