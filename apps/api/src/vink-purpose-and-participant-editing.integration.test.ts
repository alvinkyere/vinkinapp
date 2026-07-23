/**
 * Slice I5B (D39/D40) — real-Postgres proof of purpose persistence and draft-only guest
 * editing/removal, against the real HTTP surface. Both are additive to I4/I4B's already-
 * proven pipeline (`guest-invitation-delivery.integration.test.ts`); this file's own job is
 * the NEW surface — `purpose` on create/read, and `PATCH .../guest` / `DELETE .../participants/:id`
 * during DRAFT — not re-proving dispatch itself.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { MockDeliveryProvider } from '../../../packages/delivery/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe(
  'purpose + draft-only participant editing/removal (PostgreSQL, Slice I5B)',
  { skip: !RUN },
  () => {
    let db: IsolatedTestDb;
    let app: Awaited<ReturnType<typeof buildApp>>;
    let deliveryProvider: MockDeliveryProvider;
    const stamp = Date.now();
    const shortStamp = String(stamp).slice(-6);

    function authed(token: string) {
      return { authorization: `Bearer ${token}` };
    }

    async function register(username: string): Promise<{ token: string }> {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { username, displayName: username, password: 'integration-password-1' },
      });
      assert.equal(response.statusCode, 201, `register(${username}) failed: ${response.body}`);
      return { token: response.json().accessToken as string };
    }

    async function createDraftVink(
      organizerToken: string,
      extra: Record<string, unknown> = {},
    ): Promise<{ id: string; body: Record<string, unknown> }> {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/vinks',
        headers: authed(organizerToken),
        payload: {
          purchaseCategory: 'GROCERY',
          subtotalMinor: 6_000,
          tipMinor: 0,
          submissionDeadline: FUTURE,
          organizerDisplayName: 'I5B Organizer',
          ...extra,
        },
      });
      assert.equal(response.statusCode, 201, `createDraftVink failed: ${response.body}`);
      const body = response.json();
      return { id: body.vink.id as string, body };
    }

    async function inviteGuest(
      organizerToken: string,
      vinkId: string,
      payload: Record<string, unknown>,
    ) {
      return app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/guests`,
        headers: authed(organizerToken),
        payload,
      });
    }

    before(async () => {
      db = await createIsolatedTestDb('purpose_and_participant_editing');
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

    it('purpose is accepted at create, persisted separately from category, and readable back', async () => {
      const organizer = await register(`i5b_purpose_${shortStamp}`);
      const created = await createDraftVink(organizer.token, { purpose: 'Team lunch' });
      assert.equal((created.body.vink as Record<string, unknown>).purpose, 'Team lunch');
      assert.equal((created.body.vink as Record<string, unknown>).purchaseCategory, 'GROCERY');

      const fetched = await app.inject({
        method: 'GET',
        url: `/api/v1/vinks/${created.id}`,
        headers: authed(organizer.token),
      });
      assert.equal(fetched.statusCode, 200);
      assert.equal(fetched.json().vink.purpose, 'Team lunch');
    });

    it('a historical-shaped create (no purpose, the old-flow request body) stores and reads back null', async () => {
      const organizer = await register(`i5b_nopurpose_${shortStamp}`);
      const created = await createDraftVink(organizer.token);
      assert.equal((created.body.vink as Record<string, unknown>).purpose, null);

      const fetched = await app.inject({
        method: 'GET',
        url: `/api/v1/vinks/${created.id}`,
        headers: authed(organizer.token),
      });
      assert.equal(fetched.json().vink.purpose, null);
    });

    it('edit guest display name, SMS destination, email destination, and delivery mode — all via PATCH', async () => {
      const organizer = await register(`i5b_edit_${shortStamp}`);
      const vink = await createDraftVink(organizer.token, { purpose: 'Edit-guest test' });
      const invited = await inviteGuest(organizer.token, vink.id, {
        displayName: 'Original',
        deliveryMode: 'sms',
        contactDestination: `+1555${stamp}0`,
      });
      assert.equal(invited.statusCode, 201, invited.body);
      const participantId = invited.json().participant.id as string;

      // Edit display name only.
      const renamed = await app.inject({
        method: 'PATCH',
        url: `/api/v1/vinks/${vink.id}/participants/${participantId}/guest`,
        headers: authed(organizer.token),
        payload: {
          displayName: 'Renamed',
          deliveryMode: 'sms',
          contactDestination: `+1555${stamp}0`,
        },
      });
      assert.equal(renamed.statusCode, 200, renamed.body);
      assert.equal(renamed.json().participant.displayName, 'Renamed');

      // Edit the SMS destination.
      const newPhone = `+1555${stamp}1`;
      const editedPhone = await app.inject({
        method: 'PATCH',
        url: `/api/v1/vinks/${vink.id}/participants/${participantId}/guest`,
        headers: authed(organizer.token),
        payload: { displayName: 'Renamed', deliveryMode: 'sms', contactDestination: newPhone },
      });
      assert.equal(editedPhone.statusCode, 200, editedPhone.body);

      // Change delivery mode SMS -> EMAIL.
      const toEmail = await app.inject({
        method: 'PATCH',
        url: `/api/v1/vinks/${vink.id}/participants/${participantId}/guest`,
        headers: authed(organizer.token),
        payload: {
          displayName: 'Renamed',
          deliveryMode: 'email',
          contactDestination: `guest_${stamp}@example.com`,
        },
      });
      assert.equal(toEmail.statusCode, 200, toEmail.body);
      assert.equal(toEmail.json().deliveryMode, 'email');

      const [row] = await db.sql`
        SELECT g.delivery_mode, g.contact_destination, g.contact_method, g.access_token_hash
        FROM guest_identities g JOIN participants p ON p.guest_identity_id = g.id
        WHERE p.id = ${participantId}`;
      assert.equal(row!.delivery_mode, 'EMAIL');
      assert.equal(row!.contact_destination, `guest_${stamp}@example.com`);
      assert.equal(row!.access_token_hash, null);
    });

    it('changing mode to MANUAL mints and returns a fresh token; changing away from MANUAL clears it', async () => {
      const organizer = await register(`i5b_mode_${shortStamp}`);
      const vink = await createDraftVink(organizer.token);
      const invited = await inviteGuest(organizer.token, vink.id, {
        displayName: 'Mode Guest',
        deliveryMode: 'sms',
        contactDestination: `+1555${stamp}2`,
      });
      const participantId = invited.json().participant.id as string;

      const toManual = await app.inject({
        method: 'PATCH',
        url: `/api/v1/vinks/${vink.id}/participants/${participantId}/guest`,
        headers: authed(organizer.token),
        payload: { displayName: 'Mode Guest', deliveryMode: 'manual' },
      });
      assert.equal(toManual.statusCode, 200, toManual.body);
      assert.match(toManual.json().guestToken, /^vgt_/);
      assert.match(toManual.json().joinUrl, /^https?:\/\//);

      const [afterManual] = await db.sql`
        SELECT g.access_token_hash FROM guest_identities g
        JOIN participants p ON p.guest_identity_id = g.id WHERE p.id = ${participantId}`;
      const manualHash = afterManual!.access_token_hash as string;
      assert.notEqual(manualHash, null);

      const backToSms = await app.inject({
        method: 'PATCH',
        url: `/api/v1/vinks/${vink.id}/participants/${participantId}/guest`,
        headers: authed(organizer.token),
        payload: {
          displayName: 'Mode Guest',
          deliveryMode: 'sms',
          contactDestination: `+1555${stamp}3`,
        },
      });
      assert.equal(backToSms.statusCode, 200, backToSms.body);
      assert.equal(
        backToSms.json().guestToken,
        undefined,
        'no token is ever returned for sms/email mode',
      );

      const [afterSms] = await db.sql`
        SELECT g.access_token_hash FROM guest_identities g
        JOIN participants p ON p.guest_identity_id = g.id WHERE p.id = ${participantId}`;
      assert.equal(
        afterSms!.access_token_hash,
        null,
        'the old manual token must be cleared, not left valid',
      );
    });

    it('rejects an invalid edited destination (400) and a manual edit carrying a destination (400)', async () => {
      const organizer = await register(`i5b_invalid_${shortStamp}`);
      const vink = await createDraftVink(organizer.token);
      const invited = await inviteGuest(organizer.token, vink.id, {
        displayName: 'Guest',
        deliveryMode: 'sms',
        contactDestination: `+1555${stamp}4`,
      });
      const participantId = invited.json().participant.id as string;

      const badEmail = await app.inject({
        method: 'PATCH',
        url: `/api/v1/vinks/${vink.id}/participants/${participantId}/guest`,
        headers: authed(organizer.token),
        payload: {
          displayName: 'Guest',
          deliveryMode: 'email',
          contactDestination: 'not-an-email',
        },
      });
      assert.equal(badEmail.statusCode, 400, badEmail.body);

      const manualWithDestination = await app.inject({
        method: 'PATCH',
        url: `/api/v1/vinks/${vink.id}/participants/${participantId}/guest`,
        headers: authed(organizer.token),
        payload: {
          displayName: 'Guest',
          deliveryMode: 'manual',
          contactDestination: 'should-not-be-here',
        },
      });
      assert.equal(manualWithDestination.statusCode, 400, manualWithDestination.body);
    });

    it('rejects editing once the vink is OPEN (draft-only)', async () => {
      const organizer = await register(`i5b_postopen_${shortStamp}`);
      const vink = await createDraftVink(organizer.token);
      await register(`i5b_postopen_mem_${shortStamp}`);
      await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vink.id}/participants`,
        headers: authed(organizer.token),
        payload: { username: `i5b_postopen_mem_${shortStamp}` },
      });
      const invited = await inviteGuest(organizer.token, vink.id, {
        displayName: 'Guest',
        deliveryMode: 'manual',
      });
      const participantId = invited.json().participant.id as string;
      await app.inject({
        method: 'PUT',
        url: `/api/v1/vinks/${vink.id}/split`,
        headers: authed(organizer.token),
        payload: { method: 'EQUAL' },
      });
      const opened = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vink.id}/open`,
        headers: authed(organizer.token),
      });
      assert.equal(opened.statusCode, 200, opened.body);

      const editAfterOpen = await app.inject({
        method: 'PATCH',
        url: `/api/v1/vinks/${vink.id}/participants/${participantId}/guest`,
        headers: authed(organizer.token),
        payload: { displayName: 'Too Late', deliveryMode: 'manual' },
      });
      assert.equal(editAfterOpen.statusCode, 422, editAfterOpen.body);
    });

    it('removes a guest during DRAFT via the existing DELETE endpoint; a removed guest token no longer authenticates', async () => {
      const organizer = await register(`i5b_remove_${shortStamp}`);
      const vink = await createDraftVink(organizer.token);
      const invited = await inviteGuest(organizer.token, vink.id, {
        displayName: 'Removable Guest',
        deliveryMode: 'manual',
      });
      const participantId = invited.json().participant.id as string;
      const guestToken = invited.json().guestToken as string;

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/v1/vinks/${vink.id}/participants/${participantId}`,
        headers: authed(organizer.token),
      });
      assert.equal(removed.statusCode, 200, removed.body);

      // Privacy: a removed guest's own already-issued token must stop working (Slice I5B
      // finding — `findGuestParticipant` previously never filtered out REMOVED participants).
      const guestView = await app.inject({
        method: 'GET',
        url: '/api/v1/guest/session',
        headers: authed(guestToken),
      });
      assert.equal(guestView.statusCode, 401, guestView.body);
    });

    it('the organizer cannot be removed (existing removeParticipantCommand semantics, unchanged)', async () => {
      const organizer = await register(`i5b_orgremove_${shortStamp}`);
      const vink = await createDraftVink(organizer.token);
      const snapshot = await app.inject({
        method: 'GET',
        url: `/api/v1/vinks/${vink.id}`,
        headers: authed(organizer.token),
      });
      const organizerParticipantId = (
        snapshot.json().participants as Array<Record<string, unknown>>
      ).find((p) => p.role === 'ORGANIZER')!.id as string;

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/v1/vinks/${vink.id}/participants/${organizerParticipantId}`,
        headers: authed(organizer.token),
      });
      assert.equal(removed.statusCode, 422, removed.body);
    });

    it('no invitation dispatch occurs while editing a guest during DRAFT', async () => {
      const organizer = await register(`i5b_nodispatch_${shortStamp}`);
      const vink = await createDraftVink(organizer.token);
      const invited = await inviteGuest(organizer.token, vink.id, {
        displayName: 'Quiet Guest',
        deliveryMode: 'sms',
        contactDestination: `+1555${stamp}5`,
      });
      const participantId = invited.json().participant.id as string;
      const before = deliveryProvider.sent.length;

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/vinks/${vink.id}/participants/${participantId}/guest`,
        headers: authed(organizer.token),
        payload: {
          displayName: 'Quiet Guest Renamed',
          deliveryMode: 'email',
          contactDestination: `quiet_${stamp}@example.com`,
        },
      });
      assert.equal(
        deliveryProvider.sent.length,
        before,
        'editing during DRAFT must never trigger a dispatch attempt — VINK_OPENED is the only trigger',
      );
    });
  },
);
