/**
 * Vink lifecycle end-to-end — the PV3 exit gate ("a complete Vink can be managed through
 * API tests"). Requires real PostgreSQL; skipped unless VINKIN_INTEGRATION=1 (CI services).
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { PostgresVinkStore } from './modules/vinks/store.ts';
import type { VinkId } from '../../../packages/domain/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe('vink lifecycle end-to-end (PostgreSQL)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const stamp = Date.now();
  const organizer = `pv3_org_${stamp}`;
  const memberA = `pv3_a_${stamp}`;
  const memberB = `pv3_b_${stamp}`;
  const tokens: Record<string, string> = {};

  async function register(username: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username, displayName: username, password: 'integration-password-1' },
    });
    assert.equal(response.statusCode, 201);
    return response.json().accessToken;
  }

  function authed(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  before(async () => {
    db = await createIsolatedTestDb('vinks');
    app = await buildApp({
      env: db.env,
      sql: db.sql,
      checkDb: async () => {
        await db.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    tokens.organizer = await register(organizer);
    tokens.memberA = await register(memberA);
    tokens.memberB = await register(memberB);
  });

  after(async () => {
    await app.close();
    await db.drop();
  });

  it('create → add members → split → open → activity → cancel (full organizer journey)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: authed(tokens.organizer!),
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 12_000,
        tipMinor: 0,
        submissionDeadline: FUTURE,
        organizerDisplayName: 'Organizer',
      },
    });
    assert.equal(created.statusCode, 201);
    const vinkId = created.json().vink.id as string;
    assert.equal(created.json().vink.state, 'DRAFT');

    for (const username of [memberA, memberB]) {
      const added = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/participants`,
        headers: authed(tokens.organizer!),
        payload: { username },
      });
      assert.equal(added.statusCode, 201);
    }

    // A member cannot manage the organizer's vink.
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: authed(tokens.memberA!),
      payload: {},
    });
    assert.equal(forbidden.statusCode, 403);

    // Opening before a split is a 422 with the unallocated remainder in the message.
    const premature = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: authed(tokens.organizer!),
      payload: {},
    });
    assert.equal(premature.statusCode, 422);

    const split = await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: authed(tokens.organizer!),
      payload: { method: 'EQUAL' },
    });
    assert.equal(split.statusCode, 200);
    assert.deepEqual(
      split
        .json()
        .participants.map(
          (participant: { allocatedAmount: { amountMinor: number } }) =>
            participant.allocatedAmount.amountMinor,
        ),
      [4000, 4000, 4000],
    );

    let snapshot = await app.inject({
      method: 'GET',
      url: `/api/v1/vinks/${vinkId}`,
      headers: authed(tokens.organizer!),
    });
    assert.equal(snapshot.statusCode, 200);
    assert.ok(snapshot.json().allowedActions.includes('OPEN_VINK'));
    assert.equal(snapshot.json().unallocatedAmountMinor, 0);

    const opened = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: authed(tokens.organizer!),
      payload: {},
    });
    assert.equal(opened.statusCode, 200);
    assert.equal(opened.json().state, 'OPEN');

    // Stale expectedVersion → 409 VINK_VERSION_CONFLICT (Plan §11).
    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/cancel`,
      headers: authed(tokens.organizer!),
      payload: { expectedVersion: 1 },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error, 'VINK_VERSION_CONFLICT');

    const activity = await app.inject({
      method: 'GET',
      url: `/api/v1/vinks/${vinkId}/activity`,
      headers: authed(tokens.organizer!),
    });
    assert.equal(activity.statusCode, 200);
    const entries = activity.json() as Array<{ kind: string; detail: Record<string, unknown> }>;
    const eventTypes = entries
      .filter((entry) => entry.kind === 'event')
      .map((entry) => entry.detail.eventType);
    assert.deepEqual(eventTypes, [
      'VinkCreated',
      'ParticipantJoined',
      'ParticipantJoined',
      'ParticipantAllocationChanged',
      'VinkOpened',
    ]);
    const transitions = entries.filter((entry) => entry.kind === 'transition');
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0]!.detail.event, 'VINK_OPENED');

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/cancel`,
      headers: authed(tokens.organizer!),
      payload: {},
    });
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.json().state, 'CANCELLED');

    snapshot = await app.inject({
      method: 'GET',
      url: `/api/v1/vinks/${vinkId}`,
      headers: authed(tokens.organizer!),
    });
    assert.deepEqual(snapshot.json().allowedActions, []);
  });

  it('remove participant → cover remaining → open (journey E3, PV3 form)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: authed(tokens.organizer!),
      payload: {
        purchaseCategory: 'RETAIL',
        subtotalMinor: 10_000,
        tipMinor: 0,
        submissionDeadline: FUTURE,
        organizerDisplayName: 'Organizer',
      },
    });
    const vinkId = created.json().vink.id as string;

    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: authed(tokens.organizer!),
      payload: { username: memberA },
    });
    const removedId = added.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: authed(tokens.organizer!),
      payload: { username: memberB },
    });

    // Custom split: organizer 0, A 8000, B 2000.
    const participantsSnapshot = await app.inject({
      method: 'GET',
      url: `/api/v1/vinks/${vinkId}`,
      headers: authed(tokens.organizer!),
    });
    const participants = participantsSnapshot.json().participants as Array<{
      id: string;
      role: string;
    }>;
    const byRole = (role: string) => participants.filter((p) => p.role === role);
    const custom = await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: authed(tokens.organizer!),
      payload: {
        method: 'CUSTOM_AMOUNT',
        amounts: [
          { participantId: byRole('ORGANIZER')[0]!.id, amountMinor: 0 },
          { participantId: removedId, amountMinor: 8000 },
          {
            participantId: byRole('MEMBER').find((p) => p.id !== removedId)!.id,
            amountMinor: 2000,
          },
        ],
      },
    });
    assert.equal(custom.statusCode, 200);

    // Member A drops out; their $80 becomes unallocated.
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/vinks/${vinkId}/participants/${removedId}`,
      headers: authed(tokens.organizer!),
    });
    assert.equal(removed.statusCode, 200);
    const snapshot = await app.inject({
      method: 'GET',
      url: `/api/v1/vinks/${vinkId}`,
      headers: authed(tokens.organizer!),
    });
    assert.equal(snapshot.json().unallocatedAmountMinor, 8000);
    assert.ok(snapshot.json().allowedActions.includes('COVER_REMAINING'));

    const covered = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/cover-remaining`,
      headers: authed(tokens.organizer!),
      payload: {},
    });
    assert.equal(covered.statusCode, 200);

    const opened = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: authed(tokens.organizer!),
      payload: {},
    });
    assert.equal(opened.statusCode, 200, JSON.stringify(opened.json()));
    assert.equal(opened.json().state, 'OPEN');
  });

  it('concurrent open requests produce exactly one success (row-lock serialization)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: authed(tokens.organizer!),
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 6_000,
        tipMinor: 0,
        submissionDeadline: FUTURE,
        organizerDisplayName: 'Organizer',
      },
    });
    const vinkId = created.json().vink.id as string;
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: authed(tokens.organizer!),
      payload: { username: memberA },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: authed(tokens.organizer!),
      payload: { method: 'EQUAL' },
    });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST',
          url: `/api/v1/vinks/${vinkId}/open`,
          headers: authed(tokens.organizer!),
          payload: {},
        }),
      ),
    );
    const statuses = responses.map((response) => response.statusCode).sort();
    assert.deepEqual(statuses, [200, 409, 409, 409, 409]);
    // Exactly one VinkOpened event and one transition row exist.
    const opened = await db.sql`
      SELECT (SELECT count(*)::int FROM outbox_events
              WHERE aggregate_id = ${vinkId} AND event_type = 'VinkOpened') AS events,
             (SELECT count(*)::int FROM vink_state_history
              WHERE vink_id = ${vinkId} AND event = 'VINK_OPENED') AS transitions`;
    assert.deepEqual(opened[0], { events: 1, transitions: 1 });
  });

  it('a failing unit of work rolls back aggregate, history, and outbox together (D12 atomicity)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: authed(tokens.organizer!),
      payload: {
        purchaseCategory: 'RETAIL',
        subtotalMinor: 5_000,
        tipMinor: 0,
        submissionDeadline: FUTURE,
        organizerDisplayName: 'Organizer',
      },
    });
    const vinkId = created.json().vink.id as VinkId;
    const versionBefore = created.json().vink.version as number;

    const store = new PostgresVinkStore(db.sql);
    await assert.rejects(
      store.run(async (tx) => {
        const vink = await tx.getVinkForUpdate(vinkId);
        assert.ok(vink);
        await tx.updateVink({ ...vink, version: vink.version + 1 });
        await tx.appendHistory({
          vinkId,
          fromState: 'DRAFT',
          event: 'VINK_OPENED',
          toState: 'OPEN',
          actor: 'rollback-test',
          correlationId: 'rollback-test',
        });
        await tx.insertOutbox({
          eventType: 'VinkOpened',
          aggregateType: 'vink',
          aggregateId: vinkId,
          payload: { rollbackTest: true },
        });
        throw new Error('forced failure after all writes');
      }),
      /forced failure/,
    );

    const after = await db.sql`
      SELECT (SELECT version::int FROM vinks WHERE id = ${vinkId}) AS version,
             (SELECT count(*)::int FROM vink_state_history
              WHERE vink_id = ${vinkId} AND actor = 'rollback-test') AS history,
             (SELECT count(*)::int FROM outbox_events
              WHERE aggregate_id = ${vinkId} AND payload ? 'rollbackTest') AS outbox`;
    assert.deepEqual(after[0], { version: versionBefore, history: 0, outbox: 0 });
  });

  it('rejects unsupported categories (422) and unknown vinks (404)', async () => {
    const hotel = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: authed(tokens.organizer!),
      payload: {
        purchaseCategory: 'HOTEL',
        subtotalMinor: 10_000,
        tipMinor: 0,
        submissionDeadline: FUTURE,
        organizerDisplayName: 'Organizer',
      },
    });
    assert.equal(hotel.statusCode, 422);
    assert.equal(hotel.json().error, 'UNSUPPORTED_PURCHASE_CATEGORY');

    const missing = await app.inject({
      method: 'GET',
      url: `/api/v1/vinks/00000000-0000-4000-8000-000000000000`,
      headers: authed(tokens.organizer!),
    });
    assert.equal(missing.statusCode, 404);
  });
});
