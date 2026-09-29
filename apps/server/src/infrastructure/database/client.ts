import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from './migrations.js';
import * as schema from './schema.js';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export function openDatabase(filename: string): { sqlite: Database.Database; db: AppDatabase } {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const sqlite = new Database(filename);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  if (filename !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  migrate(sqlite);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}
