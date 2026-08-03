/**
 * Slice I4B (D38) — automatic invitation delivery, guest path, against real PostgreSQL. I4's
 * own `invitation-delivery.integration.test.ts` covers the member path only (its own doc
 * comment explains why guest dispatch wasn't wired in that pass); this file is the sibling
 * I4B closes the gap with: deferred token minting, VINK_OPENED-triggered dispatch, resend,
 * the sms/email/manual delivery-mode contract, and the privacy/logging review the brief asks
 * for by name.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { MockDeliveryProvider } from '../../../packages/delivery/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe(
  'automatic invitation delivery — guest path (PostgreSQL, Slice I4B)',
  { skip: !RUN },
  () => {
    let db: IsolatedTestDb;
    let app: Awaited<ReturnType<typeof buildApp>>;
    let deliveryProvider: MockDeliveryProvider;
    const stamp = Date.now();
    // Usernames are capped at 32 chars (`registerSchema`, apps/api/src/modules/auth/routes.ts)
    // — every username-bearing prefix below stays under that with this shorter suffix. Contact
    // destinations (email/phone) have no such limit, so they use the full, more-unique `stamp`.
    const shortStamp = String(stamp).slice(-6);

    function authed(token: string) {
      return { authorization: `Bearer ${token}` };
    }

    async function register(username: string): Promise<{ userId: string; token: string }> {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { username, displayName: username, password: 'integration-password-1' },
      });
      assert.equal(response.statusCode, 201, `register(${username}) failed: ${response.body}`);
      const body = response.json();
      return { userId: body.user.id as string, token: body.accessToken as string };
    }

    async function createDraftVink(organizerToken: string): Promise<string> {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/vinks',
        headers: authed(organizerToken),
        payload: {
          purchaseCategory: 'GROCERY',
          subtotalMinor: 6_000,
          tipMinor: 0,
          submissionDeadline: FUTURE,
          organizerDisplayName: 'I4B Organizer',
        },
      });
      assert.equal(response.statusCode, 201, `createDraftVink failed: ${response.body}`);
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
        headers: authed(organizerToken),
        payload: { username },
      });
      assert.equal(response.statusCode, 201, `addMember(${username}) failed: ${response.body}`);
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

    async function split(organizerToken: string, vinkId: string): Promise<void> {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/vinks/${vinkId}/split`,
        headers: authed(organizerToken),
        payload: { method: 'EQUAL' },
      });
      assert.equal(response.statusCode, 200, `split failed: ${response.body}`);
    }

    async function openVink(organizerToken: string, vinkId: string) {
      return app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/open`,
        headers: authed(organizerToken),
      });
    }

    before(async () => {
      db = await createIsolatedTestDb('guest_invitation_delivery');
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

    it('SMS mode requires a phone destination; EMAIL mode requires an email destination', async () => {
      const organizer = await register(`i4b_val_${shortStamp}`);
      const vinkId = await createDraftVink(organizer.token);

      const noPhone = await inviteGuest(organizer.token, vinkId, {
        displayName: 'Phone Guest',
        deliveryMode: 'sms',
      });
      assert.equal(noPhone.statusCode, 400);

      const badPhone = await inviteGuest(organizer.token, vinkId, {
        displayName: 'Phone Guest',
        deliveryMode: 'sms',
        contactDestination: 'not-a-phone',
      });
      assert.equal(badPhone.statusCode, 400);

      const noEmail = await inviteGuest(organizer.token, vinkId, {
        displayName: 'Email Guest',
        deliveryMode: 'email',
      });
      assert.equal(noEmail.statusCode, 400);

      const badEmail = await inviteGuest(organizer.token, vinkId, {
        displayName: 'Email Guest',
        deliveryMode: 'email',
        contactDestination: 'not-an-email',
      });
      assert.equal(badEmail.statusCode, 400);

      const manualWithDestination = await inviteGuest(organizer.token, vinkId, {
        displayName: 'Manual Guest',
        deliveryMode: 'manual',
        contactDestination: 'should-not-be-set@example.com',
      });
      assert.equal(manualWithDestination.statusCode, 400);
    });

    it(
      'a guest invited while DRAFT with sms/email mode is not dispatched until VINK_OPENED; ' +
        'only the token hash is ever persisted; duplicate open does not duplicate the send',
      async () => {
        const organizer = await register(`i4b_ord_${shortStamp}`);
        await register(`i4b_member_${shortStamp}`);
        const vinkId = await createDraftVink(organizer.token);
        await addMember(organizer.token, vinkId, `i4b_member_${shortStamp}`);

        const invited = await inviteGuest(organizer.token, vinkId, {
          displayName: 'Phone Guest',
          deliveryMode: 'sms',
          contactDestination: `+1555${stamp}`,
        });
        assert.equal(invited.statusCode, 201, invited.body);
        const invitedBody = invited.json();
        assert.equal(invitedBody.deliveryStatus, 'pending');
        assert.equal(invitedBody.guestToken, undefined, 'no token is returned for sms/email mode');
        const participantId = invitedBody.participant.id as string;

        // Not dispatched yet — still DRAFT.
        assert.equal(
          deliveryProvider.sent.length,
          0,
          'never before VINK_OPENED — a DRAFT-time sms/email invite must not dispatch',
        );

        const [beforeOpenRow] = await db.sql`
        SELECT g.access_token_hash, g.delivery_mode, g.expires_at
        FROM guest_identities g JOIN participants p ON p.guest_identity_id = g.id
        WHERE p.id = ${participantId}`;
        assert.equal(beforeOpenRow!.access_token_hash, null, 'no token minted before dispatch');
        assert.equal(beforeOpenRow!.delivery_mode, 'SMS');

        await split(organizer.token, vinkId);
        const opened = await openVink(organizer.token, vinkId);
        assert.equal(opened.statusCode, 200, opened.body);

        assert.equal(deliveryProvider.sent.length, 1, 'VINK_OPENED dispatches the pending guest');
        assert.equal(deliveryProvider.sent[0]!.method, 'SMS');
        assert.match(deliveryProvider.sent[0]!.template.link ?? '', /^https?:\/\//);

        const [afterOpenRow] = await db.sql`
        SELECT g.access_token_hash FROM guest_identities g
        JOIN participants p ON p.guest_identity_id = g.id WHERE p.id = ${participantId}`;
        const persistedHash = afterOpenRow!.access_token_hash as string;
        assert.notEqual(persistedHash, null, 'a token was minted and its hash persisted');
        // The raw token/URL sent to the provider must never equal what got persisted — only a
        // SHA-256 hash of it does.
        assert.notEqual(persistedHash, deliveryProvider.sent[0]!.template.link);
        assert.ok(!(deliveryProvider.sent[0]!.template.link ?? '').includes(persistedHash));

        const [deliveryRow] = await db.sql`
        SELECT status, method FROM invitation_deliveries WHERE participant_id = ${participantId}`;
        assert.equal(deliveryRow!.status, 'SENT');

        // Duplicate open: the vink is already OPEN, so this must fail before ever reaching the
        // dispatch loop again — no second send.
        const duplicateOpen = await openVink(organizer.token, vinkId);
        assert.equal(duplicateOpen.statusCode, 409, duplicateOpen.body);
        assert.equal(
          deliveryProvider.sent.length,
          1,
          'a duplicate open must not duplicate the send',
        );
      },
    );

    it('a guest invited by sms/email once the vink is already OPEN is dispatched immediately', async () => {
      const organizer = await register(`i4b_immediate_${shortStamp}`);
      await register(`i4b_immediate_member_${shortStamp}`);
      const vinkId = await createDraftVink(organizer.token);
      await addMember(organizer.token, vinkId, `i4b_immediate_member_${shortStamp}`);
      await split(organizer.token, vinkId);
      const opened = await openVink(organizer.token, vinkId);
      assert.equal(opened.statusCode, 200, opened.body);

      const before = deliveryProvider.sent.length;
      const invited = await inviteGuest(organizer.token, vinkId, {
        displayName: 'Late Email Guest',
        deliveryMode: 'email',
        contactDestination: `late_${stamp}@example.com`,
      });
      assert.equal(invited.statusCode, 201, invited.body);
      assert.equal(invited.json().deliveryStatus, 'sent');
      assert.equal(deliveryProvider.sent.length, before + 1);
    });

    it('MANUAL mode causes no automatic send and stays exactly I4-compatible', async () => {
      const organizer = await register(`i4b_manual_${shortStamp}`);
      const vinkId = await createDraftVink(organizer.token);

      const before = deliveryProvider.sent.length;
      const invited = await inviteGuest(organizer.token, vinkId, { displayName: 'Manual Guest' });
      assert.equal(invited.statusCode, 201, invited.body);
      const body = invited.json();
      // Existing manual-share behavior, byte-for-byte: a caller that never heard of deliveryMode
      // still gets a raw token/joinUrl back immediately, exactly like I4.
      assert.match(body.guestToken, /^vgt_/);
      assert.match(body.joinUrl, /^https?:\/\//);
      assert.equal(body.deliveryMode, 'manual');
      assert.equal(body.deliveryStatus, 'manual');
      assert.equal(deliveryProvider.sent.length, before, 'manual mode never dispatches');

      // The manual guest is still a real (MEMBER-role) participant, so opening succeeds on its
      // own — and VINK_OPENED still never dispatches anything for it (MANUAL is excluded from
      // `listPendingGuestDeliveries` by construction).
      await split(organizer.token, vinkId);
      const opened = await openVink(organizer.token, vinkId);
      assert.equal(opened.statusCode, 200, opened.body);
      assert.equal(
        deliveryProvider.sent.length,
        before,
        'VINK_OPENED must not dispatch a manual guest',
      );
    });

    it('one guest sms failure does not block vink opening or the other member/guest deliveries', async () => {
      const organizer = await register(`i4b_pf_ord_${shortStamp}`);
      await register(`i4b_pf_member_${shortStamp}`);
      const vinkId = await createDraftVink(organizer.token);
      await addMember(organizer.token, vinkId, `i4b_pf_member_${shortStamp}`);

      const goodDestination = `+1555${stamp}0`;
      const badDestination = `+1555${stamp}1`;
      await inviteGuest(organizer.token, vinkId, {
        displayName: 'Good Guest',
        deliveryMode: 'sms',
        contactDestination: goodDestination,
      });
      await inviteGuest(organizer.token, vinkId, {
        displayName: 'Bad Guest',
        deliveryMode: 'sms',
        contactDestination: badDestination,
      });
      deliveryProvider.simulateFailureFor(badDestination);

      await split(organizer.token, vinkId);
      const opened = await openVink(organizer.token, vinkId);
      assert.equal(opened.statusCode, 200, opened.body);
      assert.equal(opened.json().state, 'OPEN');

      const rows = await db.sql`
        SELECT d.status, d.destination FROM invitation_deliveries d
        JOIN participants p ON p.id = d.participant_id
        WHERE p.vink_id = ${vinkId} AND d.destination IN (${goodDestination}, ${badDestination})
        ORDER BY d.destination`;
      const byDestination = new Map(rows.map((r) => [r.destination as string, r.status as string]));
      assert.equal(byDestination.get(goodDestination), 'SENT');
      assert.equal(byDestination.get(badDestination), 'FAILED');
    });

    it('flag-off: no dispatch is attempted; the guest is still created with deliveryStatus pending', async () => {
      const offApp = await buildApp({
        env: { ...db.env, VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED: '0' },
        sql: db.sql,
        deliveryProvider,
        checkDb: async () => {
          await db.sql`SELECT 1`;
        },
        checkRedis: async () => {},
      });
      try {
        const registerResponse = await offApp.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: {
            username: `i4b_off_${shortStamp}`,
            displayName: 'off',
            password: 'integration-password-1',
          },
        });
        const organizerToken = registerResponse.json().accessToken as string;
        const created = await offApp.inject({
          method: 'POST',
          url: '/api/v1/vinks',
          headers: authed(organizerToken),
          payload: {
            purchaseCategory: 'GROCERY',
            subtotalMinor: 6_000,
            tipMinor: 0,
            submissionDeadline: FUTURE,
            organizerDisplayName: 'Off Organizer',
          },
        });
        const vinkId = created.json().vink.id as string;
        const before = deliveryProvider.sent.length;
        const invited = await offApp.inject({
          method: 'POST',
          url: `/api/v1/vinks/${vinkId}/guests`,
          headers: authed(organizerToken),
          payload: {
            displayName: 'Flag Off Guest',
            deliveryMode: 'email',
            contactDestination: `flagoff_${stamp}@example.com`,
          },
        });
        assert.equal(invited.statusCode, 201, invited.body);
        assert.equal(invited.json().deliveryStatus, 'pending');
        assert.equal(
          deliveryProvider.sent.length,
          before,
          'the flag being off must keep dispatch a no-op',
        );
      } finally {
        await offApp.close();
      }
    });

    it(
      'resend is accepted, mints a fresh token invalidating the previous one, and never ' +
        'accumulates more than one valid token for the guest',
      async () => {
        // A dedicated zero-cooldown app: the shared `app` above uses the real default cooldown
        // (60s, `GUEST_RESEND_COOLDOWN_SECONDS`), and this test needs to call resend immediately
        // after VINK_OPENED's own automatic dispatch — which itself counts as a prior attempt —
        // without a real 60s sleep. The "resend gets throttled" outcome is covered separately
        // below, against the shared app's real default, so nothing here weakens that coverage.
        const zeroCooldownApp = await buildApp({
          env: {
            ...db.env,
            VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED: '1',
            GUEST_RESEND_COOLDOWN_SECONDS: 0,
          },
          sql: db.sql,
          deliveryProvider,
          checkDb: async () => {
            await db.sql`SELECT 1`;
          },
          checkRedis: async () => {},
        });
        try {
          const registerVia = async (username: string) => {
            const response = await zeroCooldownApp.inject({
              method: 'POST',
              url: '/api/v1/auth/register',
              payload: { username, displayName: username, password: 'integration-password-1' },
            });
            assert.equal(response.statusCode, 201, response.body);
            return response.json().accessToken as string;
          };
          const organizerToken = await registerVia(`i4b_resend_${shortStamp}`);
          await registerVia(`i4b_resend_mem_${shortStamp}`);
          const created = await zeroCooldownApp.inject({
            method: 'POST',
            url: '/api/v1/vinks',
            headers: authed(organizerToken),
            payload: {
              purchaseCategory: 'GROCERY',
              subtotalMinor: 6_000,
              tipMinor: 0,
              submissionDeadline: FUTURE,
              organizerDisplayName: 'Resend Organizer',
            },
          });
          const vinkId = created.json().vink.id as string;
          await zeroCooldownApp.inject({
            method: 'POST',
            url: `/api/v1/vinks/${vinkId}/participants`,
            headers: authed(organizerToken),
            payload: { username: `i4b_resend_mem_${shortStamp}` },
          });
          const destination = `resend_${stamp}@example.com`;
          const invited = await zeroCooldownApp.inject({
            method: 'POST',
            url: `/api/v1/vinks/${vinkId}/guests`,
            headers: authed(organizerToken),
            payload: {
              displayName: 'Resend Guest',
              deliveryMode: 'email',
              contactDestination: destination,
            },
          });
          const participantId = invited.json().participant.id as string;
          await zeroCooldownApp.inject({
            method: 'PUT',
            url: `/api/v1/vinks/${vinkId}/split`,
            headers: authed(organizerToken),
            payload: { method: 'EQUAL' },
          });
          await zeroCooldownApp.inject({
            method: 'POST',
            url: `/api/v1/vinks/${vinkId}/open`,
            headers: authed(organizerToken),
          });
          assert.equal(
            deliveryProvider.sent.filter((s) => s.destination === destination).length,
            1,
          );

          const [afterOpenHashRow] = await db.sql`
          SELECT g.access_token_hash FROM guest_identities g
          JOIN participants p ON p.guest_identity_id = g.id WHERE p.id = ${participantId}`;
          const firstHash = afterOpenHashRow!.access_token_hash as string;

          const resend = await zeroCooldownApp.inject({
            method: 'POST',
            url: `/api/v1/vinks/${vinkId}/participants/${participantId}/resend`,
            headers: authed(organizerToken),
          });
          assert.equal(resend.statusCode, 200, resend.body);
          assert.equal(resend.json().deliveryStatus, 'sent');
          assert.equal(
            deliveryProvider.sent.filter((s) => s.destination === destination).length,
            2,
          );

          const [afterResendHashRow] = await db.sql`
          SELECT g.access_token_hash FROM guest_identities g
          JOIN participants p ON p.guest_identity_id = g.id WHERE p.id = ${participantId}`;
          const secondHash = afterResendHashRow!.access_token_hash as string;
          assert.notEqual(
            secondHash,
            firstHash,
            'resend must invalidate the prior token (single-slot binding)',
          );

          // No uncontrolled accumulation: exactly one hash exists for this guest at any time —
          // proven directly against the table, not inferred from the response.
          const hashCount = await db.sql`
          SELECT count(*)::int AS n FROM guest_identities g
          JOIN participants p ON p.guest_identity_id = g.id
          WHERE p.id = ${participantId} AND g.access_token_hash IS NOT NULL`;
          assert.equal(hashCount[0]!.n, 1);
        } finally {
          await zeroCooldownApp.close();
        }
      },
    );

    it('a resend called immediately after a prior attempt is throttled, not double-sent', async () => {
      const organizer = await register(`i4b_thr_${shortStamp}`);
      await register(`i4b_thr_mem_${shortStamp}`);
      const vinkId = await createDraftVink(organizer.token);
      await addMember(organizer.token, vinkId, `i4b_thr_mem_${shortStamp}`);
      const destination = `throttle_${stamp}@example.com`;
      const invited = await inviteGuest(organizer.token, vinkId, {
        displayName: 'Throttle Guest',
        deliveryMode: 'email',
        contactDestination: destination,
      });
      const participantId = invited.json().participant.id as string;
      await split(organizer.token, vinkId);
      await openVink(organizer.token, vinkId); // the automatic dispatch is itself a "prior attempt"
      const sentBefore = deliveryProvider.sent.filter((s) => s.destination === destination).length;
      assert.equal(sentBefore, 1);

      const throttled = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/participants/${participantId}/resend`,
        headers: authed(organizer.token),
      });
      assert.equal(throttled.statusCode, 429, throttled.body);
      assert.equal(
        deliveryProvider.sent.filter((s) => s.destination === destination).length,
        sentBefore,
        'a throttled resend must not dispatch again',
      );
    });

    it('resend is rejected for a MANUAL-mode guest', async () => {
      const organizer = await register(`i4b_resend_manual_${shortStamp}`);
      await register(`i4b_resend_manual_member_${shortStamp}`);
      const vinkId = await createDraftVink(organizer.token);
      await addMember(organizer.token, vinkId, `i4b_resend_manual_member_${shortStamp}`);
      const invited = await inviteGuest(organizer.token, vinkId, { displayName: 'Manual Guest' });
      const participantId = invited.json().participant.id as string;
      await split(organizer.token, vinkId);
      const opened = await openVink(organizer.token, vinkId);
      assert.equal(opened.statusCode, 200, opened.body);

      const resend = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/participants/${participantId}/resend`,
        headers: authed(organizer.token),
      });
      assert.equal(resend.statusCode, 422, resend.body);
    });

    it('no raw phone, email, token, or invitation URL ever appears in a log line', async () => {
      const lines: string[] = [];
      const captureStream = new Writable({
        write(chunk, _enc, callback) {
          lines.push(chunk.toString());
          callback();
        },
      });
      const loggedApp = await buildApp({
        env: { ...db.env, VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED: '1', LOG_LEVEL: 'debug' },
        sql: db.sql,
        deliveryProvider,
        logStream: captureStream,
        checkDb: async () => {
          await db.sql`SELECT 1`;
        },
        checkRedis: async () => {},
      });
      try {
        const registerResponse = await loggedApp.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: {
            username: `i4b_log_${shortStamp}`,
            displayName: 'log',
            password: 'integration-password-1',
          },
        });
        const organizerToken = registerResponse.json().accessToken as string;
        const created = await loggedApp.inject({
          method: 'POST',
          url: '/api/v1/vinks',
          headers: authed(organizerToken),
          payload: {
            purchaseCategory: 'GROCERY',
            subtotalMinor: 6_000,
            tipMinor: 0,
            submissionDeadline: FUTURE,
            organizerDisplayName: 'Log Organizer',
          },
        });
        const vinkId = created.json().vink.id as string;
        const secretPhone = `+1900${stamp}`;
        const secretEmail = `secret_${stamp}@example.com`;
        const invited = await loggedApp.inject({
          method: 'POST',
          url: `/api/v1/vinks/${vinkId}/guests`,
          headers: authed(organizerToken),
          payload: {
            displayName: 'Logged Guest',
            deliveryMode: 'sms',
            contactDestination: secretPhone,
          },
        });
        assert.equal(invited.statusCode, 201, invited.body);

        const memberUsername = `i4b_log_member_${shortStamp}`;
        const memberRegister = await loggedApp.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: {
            username: memberUsername,
            displayName: memberUsername,
            password: 'integration-password-1',
            email: secretEmail,
          },
        });
        assert.equal(memberRegister.statusCode, 201);
        await loggedApp.inject({
          method: 'POST',
          url: `/api/v1/vinks/${vinkId}/participants`,
          headers: authed(organizerToken),
          payload: { username: memberUsername },
        });
        await loggedApp.inject({
          method: 'PUT',
          url: `/api/v1/vinks/${vinkId}/split`,
          headers: authed(organizerToken),
          payload: { method: 'EQUAL' },
        });
        const opened = await loggedApp.inject({
          method: 'POST',
          url: `/api/v1/vinks/${vinkId}/open`,
          headers: authed(organizerToken),
        });
        assert.equal(opened.statusCode, 200, opened.body);

        const sentLink = deliveryProvider.sent.find((s) => s.destination === secretPhone)?.template
          .link;
        assert.ok(sentLink, 'the sms guest was genuinely dispatched');
        const rawTokenFromLink = sentLink!.split('/').at(-1)!;

        const logText = lines.join('\n');
        assert.ok(!logText.includes(secretPhone), 'raw phone destination must never be logged');
        assert.ok(!logText.includes(secretEmail), 'raw email destination must never be logged');
        assert.ok(!logText.includes(rawTokenFromLink), 'raw guest token must never be logged');
        assert.ok(!logText.includes(sentLink!), 'the full guest join URL must never be logged');
      } finally {
        await loggedApp.close();
      }
    });
  },
);
