/**
 * Slice I4 (D19/D27) — automatic invitation delivery, member path, against real PostgreSQL.
 * The I4 prompt's own two required tests: dispatch-ordering (never before VINK_OPENED) and
 * partial-failure handling (one delivery failing never blocks or misrepresents the caller's
 * own already-committed vink/participant state). Guest-path dispatch is deliberately not
 * covered here — see packages/application/src/delivery.ts's own doc comment for the D14
 * architectural reason it isn't wired into the transport this pass.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { MockDeliveryProvider } from '../../../packages/delivery/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe(
  'automatic invitation delivery — member path (PostgreSQL, Slice I4)',
  { skip: !RUN },
  () => {
    let db: IsolatedTestDb;
    let app: Awaited<ReturnType<typeof buildApp>>;
    let deliveryProvider: MockDeliveryProvider;
    const stamp = Date.now();

    async function register(
      username: string,
      email?: string,
    ): Promise<{ userId: string; token: string }> {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username,
          displayName: username,
          password: 'integration-password-1',
          ...(email !== undefined && { email }),
        },
      });
      assert.equal(response.statusCode, 201, `register(${username}) failed: ${response.body}`);
      const body = response.json();
      return { userId: body.user.id as string, token: body.accessToken as string };
    }

    async function createDraftVink(organizerToken: string): Promise<string> {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/vinks',
        headers: { authorization: `Bearer ${organizerToken}` },
        payload: {
          purchaseCategory: 'GROCERY',
          subtotalMinor: 6_000,
          tipMinor: 0,
          submissionDeadline: FUTURE,
          organizerDisplayName: 'I4 Organizer',
        },
      });
      assert.equal(response.statusCode, 201);
      return response.json().vink.id as string;
    }

    async function addMember(
      organizerToken: string,
      vinkId: string,
      username: string,
    ): Promise<void> {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/participants`,
        headers: { authorization: `Bearer ${organizerToken}` },
        payload: { username },
      });
      assert.equal(response.statusCode, 201, `addMember(${username}) failed: ${response.body}`);
    }

    async function splitAndOpen(organizerToken: string, vinkId: string): Promise<void> {
      const split = await app.inject({
        method: 'PUT',
        url: `/api/v1/vinks/${vinkId}/split`,
        headers: { authorization: `Bearer ${organizerToken}` },
        payload: { method: 'EQUAL' },
      });
      assert.equal(split.statusCode, 200, `split failed: ${split.body}`);
      const open = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/open`,
        headers: { authorization: `Bearer ${organizerToken}` },
      });
      assert.equal(open.statusCode, 200, `open failed: ${open.body}`);
    }

    before(async () => {
      db = await createIsolatedTestDb('invitation_delivery');
      deliveryProvider = new MockDeliveryProvider();
      app = await buildApp({
        env: { ...db.env, VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED: '1' },
        sql: db.sql,
        deliveryProvider,
        checkDb: async () => {
          await db.sql`SELECT 1`;
        },
        checkRedis: async () => {},
      });
    });

    after(async () => {
      await app.close();
      await db.drop();
    });

    it(
      'dispatch-ordering: a member added while the vink is still DRAFT is NOT dispatched until ' +
        'VINK_OPENED fires; a member added once the vink is already OPEN is dispatched immediately',
      async () => {
        const organizer = await register(`i4_ord_${stamp}`);
        await register(`i4_early_${stamp}`, `early_${stamp}@example.com`);
        await register(`i4_late_${stamp}`, `late_${stamp}@example.com`);
        const vinkId = await createDraftVink(organizer.token);

        await addMember(organizer.token, vinkId, `i4_early_${stamp}`);
        // The real assertion: still DRAFT, added with a captured contact destination — must
        // NOT have been dispatched yet.
        assert.equal(
          deliveryProvider.sent.length,
          0,
          'never before VINK_OPENED — a DRAFT-time add must not dispatch',
        );

        await splitAndOpen(organizer.token, vinkId);
        assert.equal(
          deliveryProvider.sent.length,
          1,
          'VINK_OPENED must dispatch the DRAFT-time add',
        );
        assert.equal(deliveryProvider.sent[0]!.destination, `early_${stamp}@example.com`);

        // A member added AFTER the vink is already OPEN has already passed the "never before
        // VINK_OPENED" gate — there's no reason to make them wait for an event that already
        // happened, so this one fires immediately, at add-time.
        await addMember(organizer.token, vinkId, `i4_late_${stamp}`);
        assert.equal(deliveryProvider.sent.length, 2);
        assert.equal(deliveryProvider.sent[1]!.destination, `late_${stamp}@example.com`);
      },
    );

    it(
      "partial-failure: one member's delivery failing never blocks the vink's own OPEN " +
        "transition, never blocks the other member's delivery, and is recorded as FAILED",
      async () => {
        const organizer = await register(`i4pf_ord_${stamp}`);
        await register(`i4pf_good_${stamp}`, `good_${stamp}@example.com`);
        await register(`i4pf_bad_${stamp}`, `bad_${stamp}@example.com`);
        const vinkId = await createDraftVink(organizer.token);
        await addMember(organizer.token, vinkId, `i4pf_good_${stamp}`);
        await addMember(organizer.token, vinkId, `i4pf_bad_${stamp}`);

        deliveryProvider.simulateFailureFor(`bad_${stamp}@example.com`);

        const split = await app.inject({
          method: 'PUT',
          url: `/api/v1/vinks/${vinkId}/split`,
          headers: { authorization: `Bearer ${organizer.token}` },
          payload: { method: 'EQUAL' },
        });
        assert.equal(split.statusCode, 200);
        const open = await app.inject({
          method: 'POST',
          url: `/api/v1/vinks/${vinkId}/open`,
          headers: { authorization: `Bearer ${organizer.token}` },
        });
        // The actual partial-failure proof: the OPEN command itself succeeds (200), fully and
        // correctly, even though one of the two deliveries it triggered failed.
        assert.equal(
          open.statusCode,
          200,
          `open must succeed despite one delivery failing: ${open.body}`,
        );
        assert.equal(open.json().state, 'OPEN');

        const attempts = deliveryProvider.sent.filter((s) =>
          [`good_${stamp}@example.com`, `bad_${stamp}@example.com`].includes(s.destination),
        );
        assert.equal(
          attempts.length,
          2,
          'both deliveries were attempted — the failure never stopped the other',
        );

        // And it's genuinely recorded as FAILED (not silently dropped, not misrepresented as
        // SENT) in the audit trail — queried directly since no route exposes this list yet.
        const rows = await db.sql`
        SELECT d.status, d.destination FROM invitation_deliveries d
        JOIN participants p ON p.id = d.participant_id
        WHERE p.vink_id = ${vinkId}
        ORDER BY d.destination`;
        const byDestination = new Map(
          rows.map((r) => [
            (r as { destination: string }).destination,
            (r as { status: string }).status,
          ]),
        );
        assert.equal(byDestination.get(`bad_${stamp}@example.com`), 'FAILED');
        assert.equal(byDestination.get(`good_${stamp}@example.com`), 'SENT');
      },
    );
  },
);
