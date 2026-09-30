import { ROLES, type LobbyResponse, type Role } from '@beer-game/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LobbyPage } from './LobbyPage';

vi.mock('socket.io-client', () => ({
  io: () => ({
    connected: false,
    on: () => undefined,
    disconnect: () => undefined,
    connect: () => undefined,
    io: { on: () => undefined },
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
  });

  it('claims one station from this tab and leaves the rest for other tabs', async () => {
    const claimed: Role[] = [];
    let releaseClaim: (role: Role) => void = () => undefined;
    const claimGate = new Promise<Role>((resolve) => {
      releaseClaim = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/seats') && init?.method === 'POST') {
          const role = (JSON.parse(String(init.body)) as { role: Role }).role;
          claimed.push(role);
          const seated = await claimGate;
          return json({
            playerId: 'player-1',
            role: seated,
            seatToken: 'token-token-token-token',
            game: lobby([seated]),
          });
        }
        return json(lobby(claimed));
      }),
    );

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

    const buttons = await screen.findAllByRole('button', { name: 'CLAIM' });
    expect(buttons).toHaveLength(4);
    for (const button of buttons) fireEvent.click(button);

    await waitFor(() => expect(claimed).toEqual(['retailer']));
    releaseClaim('retailer');

    expect(
      await screen.findByText('This tab holds Retailer. Claim each remaining station from its own tab.'),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: 'CLAIM' })).toHaveLength(0);
    expect(screen.getAllByText('Claim from another tab')).toHaveLength(3);
  });
});
