/**
 * Outbox publisher concurrency proof (D16): two pollers racing the same unpublished rows —
 * standing in for two API instances — must publish each row EXACTLY once combined, never
 * twice (a duplicate live-update flicker) and never zero (a lost update). `FOR UPDATE SKIP
 * LOCKED` is what makes this true; without it, two concurrent `sql.begin()` transactions
 * would both select the same rows and both publish them. Requires real PostgreSQL;
 * VINKIN_INTEGRATION=1.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createIsolatedTestDb, type IsolatedTestDb } from '../testing/integration-db.ts';
import { InProcessRealtimeHub } from './hub.ts';
import { runOutboxPublish } from './outbox-publisher.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const ROW_COUNT = 50;

describe(
  'outbox publisher concurrency (PostgreSQL, FOR UPDATE SKIP LOCKED)',
  { skip: !RUN },
  () => {
    let db: IsolatedTestDb;

    before(async () => {
      db = await createIsolatedTestDb('outbox-race');
    });

    after(async () => {
      await db.drop();
    });

    it('two concurrent pollers publish every row exactly once, combined', async () => {
      const vinkId = randomUUID();
      for (let i = 0; i < ROW_COUNT; i += 1) {
        await db.sql`INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
        VALUES ('VinkOpened', 'vink', ${vinkId}, ${db.sql.json({ seq: i })})`;
      }

      const hub = new InProcessRealtimeHub();
      const received: unknown[] = [];
      await hub.subscribe(vinkId, (message) => received.push(message));

      // Two "instances" polling at once, against the same rows.
      const [countA, countB] = await Promise.all([
        runOutboxPublish(db.sql, hub, 100),
        runOutboxPublish(db.sql, hub, 100),
      ]);

      assert.equal(countA + countB, ROW_COUNT, 'every row claimed exactly once, combined');
      assert.equal(received.length, ROW_COUNT, 'every row published exactly once — no duplicates');

      const remaining = await db.sql`
      SELECT count(*)::int AS n FROM outbox_events
      WHERE aggregate_id = ${vinkId} AND published_at IS NULL`;
      assert.equal((remaining[0] as { n: number }).n, 0, 'nothing left unpublished');
    });

    it('re-running after everything is published is a harmless no-op', async () => {
      const vinkId = randomUUID();
      await db.sql`INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
      VALUES ('VinkOpened', 'vink', ${vinkId}, ${db.sql.json({})})`;
      const hub = new InProcessRealtimeHub();
      const first = await runOutboxPublish(db.sql, hub, 10);
      const second = await runOutboxPublish(db.sql, hub, 10);
      assert.equal(first, 1);
      assert.equal(second, 0);
    });
  },
);
