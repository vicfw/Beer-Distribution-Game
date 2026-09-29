import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const games = sqliteTable('games', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  status: text('status').notNull(),
  currentRound: integer('current_round').notNull(),
  rulesJson: text('rules_json').notNull(),
  version: integer('version').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const players = sqliteTable(
  'players',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('players_game_role_unique').on(table.gameId, table.role),
    uniqueIndex('players_token_hash_unique').on(table.tokenHash),
    index('players_game_idx').on(table.gameId),
  ],
);

export const rounds = sqliteTable(
  'rounds',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    number: integer('number').notNull(),
    status: text('status').notNull(),
    customerDemand: integer('customer_demand').notNull(),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.number] })],
);

export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id').notNull(),
    roundNumber: integer('round_number').notNull(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    role: text('role').notNull(),
    quantity: integer('quantity').notNull(),
    submissionId: text('submission_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('orders_submission_unique').on(table.submissionId),
    uniqueIndex('orders_round_role_unique').on(table.gameId, table.roundNumber, table.role),
    index('orders_game_round_idx').on(table.gameId, table.roundNumber),
  ],
);

export const roundResults = sqliteTable(
  'round_results',
  {
    gameId: text('game_id').notNull(),
    roundNumber: integer('round_number').notNull(),
    role: text('role').notNull(),
    shipmentArrived: integer('shipment_arrived').notNull(),
    incomingOrder: integer('incoming_order').notNull(),
    shipped: integer('shipped').notNull(),
    inventory: integer('inventory').notNull(),
    backlog: integer('backlog').notNull(),
    roundCostCents: integer('round_cost_cents').notNull(),
    totalCostCents: integer('total_cost_cents').notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.roundNumber, table.role] })],
);
