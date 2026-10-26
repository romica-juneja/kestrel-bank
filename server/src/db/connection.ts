import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';
import { seed } from './seed.js';

export type Db = Database.Database;

export interface OpenOptions {
  path?: string;
  /** Clock used for seeded transaction dates; injectable for tests. */
  now?: Date;
}

/** Opens the database, creates the schema and seeds demo data if it is empty. */
export function openDatabase({ path = ':memory:', now = new Date() }: OpenOptions = {}): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM customers').get() as { count: number };
  if (count === 0) seed(db, now);
  return db;
}
