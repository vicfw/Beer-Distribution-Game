import type { Role } from '@beer-game/shared';
import type { GameSocket } from './types.js';

type Tracked = {
  socket: GameSocket;
  playerId: string;
  role: Role;
  gameId: string;
};

export class Presence {
  private readonly byPlayer = new Map<string, Map<string, Tracked>>();
  private readonly seenDisconnect = new Set<string>();

  connect(
    playerId: string,
    role: Role,
    gameId: string,
    socket: GameSocket,
  ): { replaced: GameSocket[]; reconnected: boolean } {
    const existing = this.byPlayer.get(playerId) ?? new Map<string, Tracked>();
    const replaced = [...existing.values()]
      .filter((tracked) => tracked.socket.id !== socket.id)
      .map((tracked) => tracked.socket);
    for (const old of replaced) existing.delete(old.id);
    existing.set(socket.id, { socket, playerId, role, gameId });
    this.byPlayer.set(playerId, existing);
    return { replaced, reconnected: this.seenDisconnect.has(playerId) };
  }

  disconnect(playerId: string, socketId: string): { wentOffline: boolean } {
    const existing = this.byPlayer.get(playerId);
    if (!existing?.has(socketId)) return { wentOffline: false };
    existing.delete(socketId);
    if (existing.size > 0) return { wentOffline: false };
    this.byPlayer.delete(playerId);
    this.seenDisconnect.add(playerId);
    return { wentOffline: true };
  }

  connectedPlayerIds(gameId: string): Set<string> {
    const ids = new Set<string>();
    for (const [playerId, sockets] of this.byPlayer) {
      for (const tracked of sockets.values()) {
        if (tracked.gameId === gameId) ids.add(playerId);
      }
    }
    return ids;
  }
}
