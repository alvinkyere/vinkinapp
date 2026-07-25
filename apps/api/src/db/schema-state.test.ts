import assert from 'node:assert/strict';
import test from 'node:test';
import { compareMigrationSets, schemaStateMessage } from './schema-state.ts';

test('matching migration sets are compatible', () => {
  const state = compareMigrationSets(['0001.sql', '0002.sql'], ['0001.sql', '0002.sql']);
  assert.deepEqual(state, { missing: [], unknown: [] });
  assert.equal(schemaStateMessage(state), 'schema compatible');
});

test('a process refuses a database missing a migration from its commit', () => {
  const state = compareMigrationSets(['0001.sql', '0002.sql'], ['0001.sql']);
  assert.deepEqual(state, { missing: ['0002.sql'], unknown: [] });
  assert.match(schemaStateMessage(state), /missing: 0002\.sql/);
});

test('a process refuses a database migrated beyond its commit', () => {
  const state = compareMigrationSets(['0001.sql'], ['0001.sql', '0002.sql']);
  assert.deepEqual(state, { missing: [], unknown: ['0002.sql'] });
  assert.ok(schemaStateMessage(state).includes('unknown/newer: 0002.sql'));
});
