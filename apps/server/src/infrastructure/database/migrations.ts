import type Database from 'better-sqlite3';

const INIT_SQL = `
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('lobby', 'playing', 'finished')),
  current_round INTEGER NOT NULL,
  rules_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (game_id, role),
  UNIQUE (token_hash)
);

CREATE INDEX players_game_idx ON players (game_id);

CREATE TABLE rounds (
  game_id TEXT NOT NULL REFERENCES games(id),
  number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting_orders', 'processing', 'completed')),
  customer_demand INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (game_id, number)
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  role TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0 AND quantity <= 10000),
  submission_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (game_id, round_number) REFERENCES rounds (game_id, number),
  UNIQUE (game_id, round_number, role)
);

CREATE INDEX orders_game_round_idx ON orders (game_id, round_number);

CREATE TABLE round_results (
  game_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  role TEXT NOT NULL,
  shipment_arrived INTEGER NOT NULL,
  incoming_order INTEGER NOT NULL,
  shipped INTEGER NOT NULL,
  inventory INTEGER NOT NULL,
  backlog INTEGER NOT NULL,
  round_cost_cents INTEGER NOT NULL,
  total_cost_cents INTEGER NOT NULL,
  PRIMARY KEY (game_id, round_number, role),
  FOREIGN KEY (game_id, round_number) REFERENCES rounds (game_id, number)
);
`;

const MIGRATIONS = [{ id: '001_init', sql: INIT_SQL }] as const;

export function migrate(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const existing = new Set(
    sqlite
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((row) => (row as { id: string }).id),
  );
  const insert = sqlite.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  for (const migration of MIGRATIONS) {
    if (existing.has(migration.id)) continue;
    const apply = sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      insert.run(migration.id, new Date().toISOString());
    });
    apply();
  }
}

export function migrationsApplied(sqlite: Database.Database): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'games'")
    .get();
  return row !== undefined;
}
