import Database from 'better-sqlite3';
import type { Db, Param } from './db';

export function openNodeDb(file: string): Db {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return {
    all: <T>(sql: string, params: Param[] = []) => sqlite.prepare(sql).all(...params) as T[],
    get: <T>(sql: string, params: Param[] = []) => sqlite.prepare(sql).get(...params) as T | undefined,
    run: (sql: string, params: Param[] = []) => ({ changes: sqlite.prepare(sql).run(...params).changes }),
    exec: (sql: string) => void sqlite.exec(sql),
    transaction: <T>(fn: () => T) => sqlite.transaction(fn)(),
  };
}
