import type { Debrief, PublicRules } from './rules.js';
import type { Role } from './roles.js';

export type GameStatus = 'lobby' | 'playing' | 'finished';

export type SeatPublic = {
  role: Role;
  taken: boolean;
  connected: boolean;
  submitted: boolean;
};

export type OwnStation = {
  role: Role;
  inventory: number;
  backlog: number;
  shipmentArrived: number;
  incomingOrder: number;
  shipped: number;
  lastOrder: number;
  roundCostCents: number;
  totalCostCents: number;
  submitted: boolean;
  submittedQuantity: number | null;
};

export type OwnRoundHistory = {
  round: number;
  shipmentArrived: number;
  incomingOrder: number;
  shipped: number;
  inventory: number;
  backlog: number;
  roundCostCents: number;
  totalCostCents: number;
  orderPlaced: number;
};

export type PlayerSnapshot = {
  kind: 'player';
  version: number;
  code: string;
  status: GameStatus;
  round: number;
  roundCount: number;
  you: { playerId: string; role: Role };
  station: OwnStation | null;
  seats: SeatPublic[];
  history: OwnRoundHistory[];
  rules: PublicRules;
};

export type SpectatorSnapshot = {
  kind: 'spectator';
  version: number;
  code: string;
  status: GameStatus;
  round: number;
  roundCount: number;
  seats: SeatPublic[];
  rules: PublicRules;
  /** Present only after the game finishes. Numbers stay hidden while it is running. */
  debrief: Debrief | null;
};

export type GameSnapshot = PlayerSnapshot | SpectatorSnapshot;

export type LobbyResponse = {
  code: string;
  status: GameStatus;
  round: number;
  roundCount: number;
  seats: SeatPublic[];
  rules: PublicRules;
};

export type CreateGameResponse = {
  code: string;
};

export type JoinGameResponse = {
  playerId: string;
  role: Role;
  seatToken: string;
  game: LobbyResponse;
};

export type HistoryResponse = Debrief;
