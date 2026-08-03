/**
 * Slice I2 (docs/design/phase-10-implementation-readiness.md) — `listVinksByParticipant`
 * against real PostgreSQL, proving the new SQL actually executes correctly against the live
 * schema, not just that it typechecks. Requires real PostgreSQL; skipped unless
 * VINKIN_INTEGRATION=1 (CI services). A separate, new file (not appended to
 * vinks.integration.test.ts) to stay isolated from that file's own concurrent edits this
 * session.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { PostgresVinkStore } from './modules/vinks/store.ts';
import {
  addParticipantCommand,
  createVinkCommand,
  listMyVinksWithRole,
} from '../../../packages/application/src/index.ts';
import type { CommandContext } from '../../../packages/application/src/index.ts';
import type { UserId } from '../../../packages/domain/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe(
  'participant-inclusive retrieval end-to-end (PostgreSQL, Slice I2)',
  { skip: !RUN },
  () => {
    let db: IsolatedTestDb;
    let app: Awaited<ReturnType<typeof buildApp>>;
    let store: PostgresVinkStore;
    const stamp = Date.now();
    const organizerUsername = `i2_org_${stamp}`;
    const memberUsername = `i2_member_${stamp}`;
    let organizerUserId: string;
    let memberUserId: string;

    async function register(username: string): Promise<string> {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { username, displayName: username, password: 'integration-password-1' },
      });
      assert.equal(response.statusCode, 201);
      return response.json().user.id as string;
    }

    function ctx(actorUserId: string): CommandContext {
      return {
        uow: store,
        clock: { now: () => new Date() },
        actorUserId,
        correlationId: 'i2-test',
      };
    }

    before(async () => {
      db = await createIsolatedTestDb('vink_participant_retrieval');
      app = await buildApp({
        env: db.env,
        sql: db.sql,
        checkDb: async () => {
          await db.sql`SELECT 1`;
        },
        checkRedis: async () => {},
      });
      store = new PostgresVinkStore(db.sql);
      organizerUserId = await register(organizerUsername);
      memberUserId = await register(memberUsername);
    });

    after(async () => {
      await app.close();
      await db.drop();
    });

    it(
      'a member added by username sees the Vink via listMyVinksWithRole against real ' +
        'Postgres — the exact real-database proof of the P1-3 fix, not just the in-memory one',
      async () => {
        const created = await createVinkCommand(ctx(organizerUserId), {
          purchaseCategory: 'GROCERY',
          subtotalMinor: 4_000,
          tipMinor: 0,
          submissionDeadline: FUTURE,
          organizerDisplayName: 'Org',
        });
        await addParticipantCommand(ctx(organizerUserId), {
          vinkId: created.vink.id,
          userId: memberUserId as UserId,
          displayName: 'Member',
        });

        const memberView = await listMyVinksWithRole(store, memberUserId);
        assert.equal(memberView.length, 1);
        assert.equal(memberView[0]!.vink.id, created.vink.id);
        assert.equal(memberView[0]!.role, 'participant');

        const organizerView = await listMyVinksWithRole(store, organizerUserId);
        const own = organizerView.find((entry) => entry.vink.id === created.vink.id);
        assert.ok(own);
        assert.equal(own.role, 'organizer');
      },
    );
  },
);
