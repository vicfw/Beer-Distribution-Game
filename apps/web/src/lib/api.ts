import type { CreateGameInput, CreateGameResponse, Debrief, JoinGameResponse, LobbyResponse, Role } from '@beer-game/shared';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = parseBody(text);
  if (!response.ok) {
    throw new ApiError(body?.error?.message ?? 'Request failed', body?.error?.code ?? 'INTERNAL', response.status);
  }
  if (text && !body) {
    throw new ApiError('The server returned an unreadable response', 'INTERNAL', response.status);
  }
  return body as T;
}

export function createGame(input: CreateGameInput): Promise<CreateGameResponse> {
  return api('/api/games', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchLobby(code: string): Promise<LobbyResponse> {
  return api(`/api/games/${code}`);
}

export function claimSeat(code: string, role: Role): Promise<JoinGameResponse> {
  return api(`/api/games/${code}/seats`, { method: 'POST', body: JSON.stringify({ role }) });
}

export function fetchHistory(code: string): Promise<Debrief> {
  return api(`/api/games/${code}/history`);
}

export function fetchHealth(): Promise<{ status: string }> {
  return api('/health');
}

function parseBody(text: string): { error?: { code?: string; message?: string } } | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as { error?: { code?: string; message?: string } };
  } catch {
    return null;
  }
}
