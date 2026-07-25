import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../config/env.ts';
import { createDb } from './client.ts';
import { compareMigrationSets, schemaStateMessage } from './schema-state.ts';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const expected = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

const sql = createDb(loadEnv());
try {
  const table = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('schema_migrations') IS NOT NULL AS exists
  `;
  const applied = table[0]?.exists
    ? (await sql<{ name: string }[]>`SELECT name FROM schema_migrations ORDER BY name`).map(
        (row) => row.name,
      )
    : [];
  const state = compareMigrationSets(expected, applied);
  if (state.missing.length > 0 || state.unknown.length > 0) {
    throw new Error(schemaStateMessage(state));
  }
  process.stdout.write(`${schemaStateMessage(state)}\n`);
} finally {
  await sql.end();
}
