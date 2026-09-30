import type { Role } from '@beer-game/shared';

export type SeatSession = {
  playerId: string;
  role: Role;
  seatToken: string;
};

export type PendingOrder = {
  submissionId: string;
  round: number;
  quantity: number;
};

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode can reject storage. The tab still works until refresh.
  }
}

export function readSeat(code: string): SeatSession | null {
  return read<SeatSession>(`bdg.seat.${code}`);
}

export function writeSeat(code: string, seat: SeatSession): void {
  write(`bdg.seat.${code}`, seat);
}

export function readPending(code: string): PendingOrder | null {
  return read<PendingOrder>(`bdg.pending.${code}`);
}

export function writePending(code: string, order: PendingOrder): void {
  write(`bdg.pending.${code}`, order);
}

export function clearPending(code: string): void {
  try {
    sessionStorage.removeItem(`bdg.pending.${code}`);
  } catch {
    // Ignore storage failures.
  }
}

export function markLaunched(code: string): void {
  write(`bdg.launched.${code}`, true);
}

export function wasLaunched(code: string): boolean {
  return read<boolean>(`bdg.launched.${code}`) === true;
}
