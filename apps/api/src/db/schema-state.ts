/**
 * Startup compatibility gate for hosted deployments.
 *
 * Migrations are applied exactly once by the API service's controlled pre-deploy command.
 * API and worker processes only verify that the database contains the exact migration set
 * shipped with their commit. They never mutate schema during startup.
 */

export type SchemaState = {
  missing: string[];
  unknown: string[];
};

export function compareMigrationSets(
  expected: readonly string[],
  applied: readonly string[],
): SchemaState {
  const expectedSet = new Set(expected);
  const appliedSet = new Set(applied);

  return {
    missing: expected.filter((name) => !appliedSet.has(name)),
    unknown: applied.filter((name) => !expectedSet.has(name)),
  };
}

export function schemaStateMessage(state: SchemaState): string {
  const parts: string[] = [];
  if (state.missing.length > 0) parts.push(`missing: ${state.missing.join(', ')}`);
  if (state.unknown.length > 0) parts.push(`unknown/newer: ${state.unknown.join(', ')}`);
  return parts.length === 0 ? 'schema compatible' : `schema incompatible (${parts.join('; ')})`;
}
