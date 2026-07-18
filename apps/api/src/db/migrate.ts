/**
 * Migration runner: applies src/db/migrations/*.sql in filename order, each inside one
 * transaction, recording applied names in schema_migrations. Idempotent — re-running is a
 * no-op. Invoked via `pnpm --filter @vinkin/api migrate` (and by CI before integration tests).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../config/env.ts';
import { createDb, type Sql } from './client.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function runMigrations(sql: Sql): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied = new Set(
    (await sql`SELECT name FROM schema_migrations`).map((row) => row.name as string),
  );

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const statements = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(statements);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    newlyApplied.push(file);
  }
  return newlyApplied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sql = createDb(loadEnv());
  try {
    const applied = await runMigrations(sql);
    console.log(
      applied.length === 0 ? 'migrations: up to date' : `migrations applied: ${applied.join(', ')}`,
    );
  } finally {
    await sql.end();
  }
}
