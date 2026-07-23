import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  EVENT_CONTRACT_SOURCE,
  INTERACTIONS_WITHOUT_ANALYTICS,
  SCREEN_CONTRACT_SOURCE,
} from './traceability.ts';

function allPhase5InteractionIds(): string[] {
  return Array.from({ length: 45 }, (_, i) => `C${i + 1}`);
}

test('ENG2: the analytics-covered ids plus the no-analytics ids equal exactly C1-C45, no gaps, no overlap', () => {
  const covered = new Set(Object.values(EVENT_CONTRACT_SOURCE).flat());
  const uncovered = new Set(INTERACTIONS_WITHOUT_ANALYTICS);

  for (const id of covered) {
    assert.equal(
      uncovered.has(id),
      false,
      `${id} is listed as both analytics-covered and analytics-free`,
    );
  }

  const union = new Set([...covered, ...uncovered]);
  const expected = new Set(allPhase5InteractionIds());
  assert.deepEqual([...union].sort(), [...expected].sort());
});

test('ENG2: docs/architecture/client-contracts-traceability.md exists and names every screen and event this package declares', () => {
  const docPath = fileURLToPath(
    new URL('../../../docs/architecture/client-contracts-traceability.md', import.meta.url),
  );
  const doc = readFileSync(docPath, 'utf8');

  for (const source of Object.values(SCREEN_CONTRACT_SOURCE)) {
    assert.ok(doc.includes(source), `traceability doc is missing screen source "${source}"`);
  }
  for (const eventName of Object.keys(EVENT_CONTRACT_SOURCE)) {
    assert.ok(doc.includes(`\`${eventName}\``), `traceability doc is missing event "${eventName}"`);
  }
  for (const id of allPhase5InteractionIds()) {
    assert.ok(
      new RegExp(`\\b${id}\\b`).test(doc),
      `traceability doc never mentions interaction ${id}`,
    );
  }
});

test('ENG2: docs/architecture/client-contracts-ownership-and-privacy.md and client-contracts-versioning-policy.md exist', () => {
  for (const name of [
    'client-contracts-ownership-and-privacy.md',
    'client-contracts-versioning-policy.md',
  ]) {
    const docPath = fileURLToPath(new URL(`../../../docs/architecture/${name}`, import.meta.url));
    assert.doesNotThrow(() => readFileSync(docPath, 'utf8'), `${name} must exist`);
  }
});
