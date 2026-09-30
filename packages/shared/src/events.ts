import type { ErrorBody } from './errors.js';
import type { GameSnapshot, SeatPublic } from './dto.js';
import type { Role } from './roles.js';

export type SubmitOrderPayload = {
  round: number;
  submissionId: string;
  quantity: number;
};

export type Ack<T> = { ok: true; data: T } | { ok: false; error: ErrorBody };

export type SubmitOrderAck = {
  duplicate: boolean;
  round: number;
  quantity: number;
  advanced: boolean;
};

export type PublicPresence = {
  version: number;
  code: string;
  status: GameSnapshot['status'];
  round: number;
  seats: SeatPublic[];
};

export interface ClientToServerEvents {
  'round:submit-order': (
    payload: SubmitOrderPayload,
    ack: (result: Ack<SubmitOrderAck>) => void,
  ) => void;
  'game:leave': (ack: (result: Ack<{ left: boolean }>) => void) => void;
  'game:sync': (ack: (result: Ack<{ version: number }>) => void) => void;
}

export interface ServerToClientEvents {
  'game:state': (snapshot: GameSnapshot) => void;
  'lobby:updated': (payload: PublicPresence) => void;
  'game:started': (payload: { version: number; round: number }) => void;
  'round:started': (payload: { version: number; round: number }) => void;
  'round:updated': (payload: { version: number; round: number; submitted: Role[] }) => void;
  'round:completed': (payload: { version: number; round: number }) => void;
  'game:finished': (payload: { version: number }) => void;
  'player:disconnected': (payload: { role: Role }) => void;
  'player:reconnected': (payload: { role: Role }) => void;
  'session:replaced': (payload: { code: string }) => void;
  'game:error': (payload: ErrorBody) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export type SocketData =
  | {
      kind: 'player';
      gameId: string;
      code: string;
      playerId: string;
      role: Role;
    }
  | {
      kind: 'spectator';
      gameId: string;
      code: string;
    };
