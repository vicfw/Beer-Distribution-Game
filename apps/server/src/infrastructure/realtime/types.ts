import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@beer-game/shared';
import type { Server, Socket } from 'socket.io';

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
