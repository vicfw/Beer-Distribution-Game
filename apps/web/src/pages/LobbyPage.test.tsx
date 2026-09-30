import { ROLES, type LobbyResponse, type PublicPresence, type Role } from '@beer-game/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LobbyPage } from './LobbyPage';

const sockets = vi.hoisted(() => {
  type Listener = (payload: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  let presence: unknown = null;
  return {
    setPresence(next: unknown) {
      presence = next;
    },
    emit(event: string, payload: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
    current() {
      return presence;
    },
    reset() {
      listeners.clear();
      presence = null;
    },
    listen(event: string, handler: Listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
      if (event === 'lobby:updated' && presence) handler(presence);
    },
  };
});

vi.mock('socket.io-client', () => ({
  io: () => ({
    connected: false,
    on: (event: string, handler: (payload: unknown) => void) => {
      sockets.listen(event, handler);
    },
    disconnect: () => undefined,
    connect: () => undefined,
    timeout: () => ({
      emitWithAck: () => Promise.resolve({ ok: true, data: { alive: true } }),
    }),
    io: {
      on: () => undefined,
      reconnection: () => undefined,
      engine: { close: () => undefined },
    },
  }),
}));

const rules = {
  holdingCostCents: 50,
  backlogCostCents: 100,
  shippingDelay: 2,
  initialInventory: 12,
  initialBacklog: 0,
  roundCount: 20,
};

function presence(taken: Role[] = [], version = 1): PublicPresence {
  return { version, ...lobby(taken) };
}

function lobby(taken: Role[] = []): LobbyResponse {
  return {
    code: 'ABCD12',
    status: 'lobby',
    round: 0,
    roundCount: 20,
    seats: ROLES.map((role) => ({
      role,
      taken: taken.includes(role),
      connected: false,
      submitted: false,
    })),
    rules,
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('LobbyPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sockets.reset();
  });

  it('claims one station from this tab and leaves the rest for other tabs', async () => {
    const claimed: Role[] = [];
    let releaseClaim: (role: Role) => void = () => undefined;
    const claimGate = new Promise<Role>((resolve) => {
      releaseClaim = resolve;
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/seats') && init?.method === 'POST') {
        const role = (JSON.parse(String(init.body)) as { role: Role }).role;
        claimed.push(role);
        const seated = await claimGate;
        const next = presence([seated], 2);
        sockets.setPresence(next);
        sockets.emit('lobby:updated', next);
        return json({
          playerId: 'player-1',
          role: seated,
          seatToken: 'token-token-token-token',
          game: lobby([seated]),
        });
      }
      throw new Error(`unexpected lobby poll ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    sockets.setPresence(presence());

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/game/ABCD12/lobby']}>
          <Routes>
            <Route path="/game/:code/lobby" element={<LobbyPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText('20 ROUNDS · HOLD 0.5 · BACKLOG 1.0 · DELAY 2'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    const buttons = await screen.findAllByRole('button', { name: 'CLAIM' });
    expect(buttons).toHaveLength(4);
    for (const button of buttons) fireEvent.click(button);

    await waitFor(() => expect(claimed).toEqual(['retailer']));
    releaseClaim('retailer');

    expect(
      await screen.findByText(
        'This tab holds Retailer. Claim each remaining station from its own tab.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: 'CLAIM' })).toHaveLength(0);
    expect(screen.getAllByText('Claim from another tab')).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const joined = presence(['retailer', 'wholesaler'], 3);
    sockets.setPresence(joined);
    sockets.emit('lobby:updated', joined);
    expect(await screen.findByText('Manned')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
