/**
 * Per-suite database isolation for integration tests: each suite gets its own PostgreSQL
 * SCHEMA with a full migration run, and drops it (CASCADE) when done. Suites running
 * concurrently under `node --test` therefore never see each other's rows, cleanup needs no
 * FK ordering, and truncation between tests is unnecessary.
 */

import postgres from 'postgres';
import { loadEnv, type Env } from '../config/env.ts';
import { runMigrations } from '../db/migrate.ts';

export interface IsolatedTestDb {
  env: Env;
  sql: postgres.Sql;
  schema: string;
  drop(): Promise<void>;
}

export async function createIsolatedTestDb(suite: string): Promise<IsolatedTestDb> {
  const env = loadEnv({ ...process.env, VINKIN_ENV: 'test', LOG_LEVEL: 'error' });
  const schema = `it_${suite}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`.toLowerCase();

  const admin = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE SCHEMA "${schema}"`);
  await admin.end();

  const sql = postgres(env.DATABASE_URL, {
    max: 10,
    connect_timeout: 5,
    onnotice: () => {},
    connection: { search_path: schema },
  });
  await runMigrations(sql);

  return {
    env,
    sql,
    schema,
    async drop() {
      await sql.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await sql.end();
    },
  };
}
