/**
 * ENG4 Slice 3 ("every worker job carries a correlation id"): before this slice, `runSweeps`
 * generated a correlation id and threaded it into `ContributionCommandContext` for DB history
 * rows, but never surfaced it in a log line — a sweep tick was invisible to anyone reading
 * logs. This proves it now logs a start/end pair, tagged with a `sweep:`-prefixed correlation
 * id, against a real (isolated) Postgres schema.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createIsolatedTestDb, type IsolatedTestDb } from '../testing/integration-db.ts';
import { runSweeps } from './sweeps.ts';
import { MockFinancialProvider } from '../../../../packages/payment-provider/src/index.ts';
import type { PinoLike } from '../observability/command-logger.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

function recordingLog(): { log: PinoLike; lines: Array<[Record<string, unknown>, string]> } {
  const lines: Array<[Record<string, unknown>, string]> = [];
  return {
    lines,
    log: {
      info: (obj, msg) => lines.push([obj, msg]),
      error: (obj, msg) => lines.push([obj, msg]),
    },
  };
}

describe('runSweeps logging (ENG4 Slice 3)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let provider: MockFinancialProvider;

  before(async () => {
    db = await createIsolatedTestDb('sweep_logging');
    provider = new MockFinancialProvider();
  });
  after(async () => {
    await db.drop();
  });

  it('logs a sweep_start/sweep_end pair sharing one sweep-prefixed correlation id', async () => {
    const { log, lines } = recordingLog();
    const now = new Date();

    const result = await runSweeps(db.sql, provider, now, log);

    const start = lines.find(([, msg]) => msg === 'sweep_start');
    const end = lines.find(([, msg]) => msg === 'sweep_end');
    assert.ok(start, 'expected a sweep_start log line');
    assert.ok(end, 'expected a sweep_end log line');

    const startId = start![0].correlationId as string;
    const endId = end![0].correlationId as string;
    assert.equal(startId, endId);
    assert.match(startId, /^sweep:/);

    assert.equal(end![0].closed, result.closed);
    assert.equal(end![0].graceResolved, result.graceResolved);
    assert.equal(end![0].contributionsResolved, result.contributionsResolved);
    assert.equal(end![0].cardsProvisioned, result.cardsProvisioned);
  });

  it('two separate sweep ticks get two different correlation ids', async () => {
    const { log, lines } = recordingLog();
    await runSweeps(db.sql, provider, new Date(), log);
    await runSweeps(db.sql, provider, new Date(), log);

    const starts = lines.filter(([, msg]) => msg === 'sweep_start');
    assert.equal(starts.length, 2);
    assert.notEqual(starts[0]![0].correlationId, starts[1]![0].correlationId);
  });

  it('omitting the logger changes nothing about the sweep result (backward compatible)', async () => {
    const result = await runSweeps(db.sql, provider);
    assert.equal(typeof result.closed, 'number');
  });
});
