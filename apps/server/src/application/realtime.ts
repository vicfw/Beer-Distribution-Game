import type { GameRecord } from '../infrastructure/database/GameRepository.js';

export type GameEvent = 'started' | 'round-started' | 'order' | 'completed' | 'finished' | 'left';

export type RealtimePort = {
  publish: (game: GameRecord, events: readonly GameEvent[]) => void;
  connectedPlayerIds: (gameId: string) => ReadonlySet<string>;
};

export const noopRealtime: RealtimePort = {
  publish() {},
  connectedPlayerIds() {
    return new Set();
  },
};
