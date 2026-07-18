import postgres from 'postgres';
import type { Env } from '../config/env.ts';

export type Sql = postgres.Sql;

export function createDb(env: Env): Sql {
  return postgres(env.DATABASE_URL, {
    max: 10,
    // Fail fast instead of queueing forever when the database is down; the ready check
    // and callers surface the failure explicitly.
    connect_timeout: 5,
    // Idempotent DDL (CREATE TABLE IF NOT EXISTS) emits expected NOTICEs; don't print them.
    onnotice: () => {},
  });
}
