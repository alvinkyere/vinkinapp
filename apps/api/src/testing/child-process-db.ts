/**
 * ENG9 — a dedicated, fully separate PostgreSQL DATABASE (not just a schema, unlike
 * `createIsolatedTestDb`) for tests that spawn a REAL child OS process (`node src/server.ts`,
 * `node src/jobs/worker.ts`). A spawned process reads `DATABASE_URL` fresh from its own env —
 * it cannot share the parent test's in-process `postgres()` connection or its
 * `search_path`-scoped schema trick, so it needs a real, independently-connectable database.
 */

import postgres from 'postgres';
import { loadEnv, type Env } from '../config/env.ts';
import { runMigrations } from '../db/migrate.ts';

export interface ChildProcessTestDb {
  env: Env;
  databaseUrl: string;
  dbName: string;
  drop(): Promise<void>;
}

export async function createChildProcessTestDb(suite: string): Promise<ChildProcessTestDb> {
  const env = loadEnv({ ...process.env, VINKIN_ENV: 'test', LOG_LEVEL: 'error' });
  const dbName = `it_${suite}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`.toLowerCase();
  const base = new URL(env.DATABASE_URL);

  const admin = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const dbUrl = new URL(base.toString());
  dbUrl.pathname = `/${dbName}`;
  const databaseUrl = dbUrl.toString();

  const sql = postgres(databaseUrl, { max: 5, connect_timeout: 5, onnotice: () => {} });
  await runMigrations(sql);
  await sql.end();

  return {
    env,
    databaseUrl,
    dbName,
    async drop() {
      // A crashed/restarted child process may still hold connections briefly after exit —
      // terminate them first so DROP DATABASE doesn't fail on "database is being accessed".
      const cleanup = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
      await cleanup.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      await cleanup.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
      await cleanup.end();
    },
  };
}
