/**
 * Slice I2B (docs/design/phase-10-implementation-readiness.md) — the participant-inclusive
 * transport contract against real PostgreSQL: `GET /api/v1/vinks` flag on/off, the new
 * `GET /api/v1/vinks/:vinkId/participant-view` route, and the end-to-end regression the
 * slice's own prompt names explicitly: a registered member added to another organizer's vink
 * discovers and opens the participant experience without being the organizer. Requires real
 * PostgreSQL; skipped unless VINKIN_INTEGRATION=1 (CI services). A separate, new file (not
 * appended to vinks.integration.test.ts) to stay isolated from that file's own history of
 * concurrent edits this session.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { MockFinancialProvider } from '../../../packages/payment-provider/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
// Usernames are capped at 32 chars (`registerSchema`, apps/api/src/modules/auth/routes.ts) —
// a base36 stamp keeps every generated username well under that regardless of prefix length.
const STAMP = Date.now().toString(36);

describe('participant-inclusive transport contract (PostgreSQL, Slice I2B)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let appFlagOff: FastifyInstance;
  let appFlagOn: FastifyInstance;

  async function register(
    app: FastifyInstance,
    username: string,
  ): Promise<{ id: string; token: string; username: string }> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username, displayName: username, password: 'integration-password-1' },
    });
    assert.equal(response.statusCode, 201, `register(${username}) failed: ${response.body}`);
    const body = response.json();
    return { id: body.user.id as string, token: body.accessToken as string, username };
  }

  async function createVink(app: FastifyInstance, token: string): Promise<{ id: string }> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 4_000,
        tipMinor: 0,
        submissionDeadline: FUTURE,
        organizerDisplayName: 'Org',
      },
    });
    assert.equal(response.statusCode, 201);
    return { id: response.json().vink.id as string };
  }

  async function addMember(
    app: FastifyInstance,
    organizerToken: string,
    vinkId: string,
    username: string,
  ): Promise<{ id: string; displayName: string }> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: { authorization: `Bearer ${organizerToken}` },
      payload: { username },
    });
    assert.equal(response.statusCode, 201, `addMember(${username}) failed: ${response.body}`);
    // addParticipantCommand resolves to the bare Participant (packages/application/src/
    // commands.ts) — the route sends it unwrapped, not `{ participant }`.
    return response.json() as { id: string; displayName: string };
  }

  /** Equal-split + open, over HTTP, using only the organizer's own token — matches the exact
   * two calls the mobile Create-Vink flow makes once every participant is added. */
  async function openVink(
    app: FastifyInstance,
    organizerToken: string,
    vinkId: string,
  ): Promise<void> {
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
    db = await createIsolatedTestDb('participant_inclusive_transport');
    const deps = {
      sql: db.sql,
      // Slice I2D's own test needs the contribution routes, which `buildApp` only registers
      // when a provider is supplied — every prior test in this file never needed them.
      provider: new MockFinancialProvider(),
      checkDb: async () => {
        await db.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    };
    appFlagOff = await buildApp({
      ...deps,
      env: { ...db.env, VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL: '0' },
    });
    appFlagOn = await buildApp({
      ...deps,
      env: { ...db.env, VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL: '1' },
    });
  });

  after(async () => {
    await appFlagOff.close();
    await appFlagOn.close();
    await db.drop();
  });

  it('flag off: GET /api/v1/vinks returns organizer-owned vinks only, exact today shape (no role field)', async () => {
    const organizer = await register(appFlagOff, `i2boffo${STAMP}`);
    const member = await register(appFlagOff, `i2boffm${STAMP}`);
    const vink = await createVink(appFlagOff, organizer.token);
    await addMember(appFlagOff, organizer.token, vink.id, member.username);

    const organizerList = await appFlagOff.inject({
      method: 'GET',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${organizer.token}` },
    });
    const organizerVinks = organizerList.json().vinks as Array<Record<string, unknown>>;
    assert.ok(organizerVinks.some((v) => v.id === vink.id));
    assert.ok(
      !('role' in organizerVinks[0]!),
      'flag-off response must not carry the additive role field',
    );

    const memberList = await appFlagOff.inject({
      method: 'GET',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${member.token}` },
    });
    const memberVinks = memberList.json().vinks as Array<Record<string, unknown>>;
    assert.equal(
      memberVinks.length,
      0,
      "flag off: a member added to someone else's vink must not see it — exact pre-I2B behavior",
    );
  });

  it('flag on: GET /api/v1/vinks returns organized and participated vinks, each carrying role', async () => {
    const organizer = await register(appFlagOn, `i2bono${STAMP}`);
    const member = await register(appFlagOn, `i2bonm${STAMP}`);
    const vink = await createVink(appFlagOn, organizer.token);
    await addMember(appFlagOn, organizer.token, vink.id, member.username);

    const memberList = await appFlagOn.inject({
      method: 'GET',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${member.token}` },
    });
    const memberVinks = memberList.json().vinks as Array<Record<string, unknown>>;
    const entry = memberVinks.find((v) => v.id === vink.id);
    assert.ok(entry, 'member must discover the vink they were added to');
    assert.equal(entry!.role, 'participant');

    const organizerList = await appFlagOn.inject({
      method: 'GET',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${organizer.token}` },
    });
    const organizerVinks = organizerList.json().vinks as Array<Record<string, unknown>>;
    const ownEntry = organizerVinks.find((v) => v.id === vink.id);
    assert.ok(ownEntry);
    assert.equal(ownEntry!.role, 'organizer');
  });

  it('organizer who is also a participant appears exactly once, organizer role wins', async () => {
    const organizer = await register(appFlagOn, `i2bdedo${STAMP}`);
    const vink = await createVink(appFlagOn, organizer.token);

    const list = await appFlagOn.inject({
      method: 'GET',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${organizer.token}` },
    });
    const vinks = list.json().vinks as Array<Record<string, unknown>>;
    const matches = vinks.filter((v) => v.id === vink.id);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]!.role, 'organizer');
  });

  it('a removed participant does not receive the vink in their list', async () => {
    const organizer = await register(appFlagOn, `i2bremo${STAMP}`);
    const member = await register(appFlagOn, `i2bremm${STAMP}`);
    const vink = await createVink(appFlagOn, organizer.token);
    const added = await addMember(appFlagOn, organizer.token, vink.id, member.username);

    const removed = await appFlagOn.inject({
      method: 'DELETE',
      url: `/api/v1/vinks/${vink.id}/participants/${added.id}`,
      headers: { authorization: `Bearer ${organizer.token}` },
    });
    assert.equal(removed.statusCode, 200, `remove failed: ${removed.body}`);

    const memberList = await appFlagOn.inject({
      method: 'GET',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${member.token}` },
    });
    const memberVinks = memberList.json().vinks as Array<Record<string, unknown>>;
    assert.ok(!memberVinks.some((v) => v.id === vink.id));
  });

  it('newest-first ordering holds across the organizer∪participant union', async () => {
    const organizer = await register(appFlagOn, `i2bordo${STAMP}`);
    const member = await register(appFlagOn, `i2bordm${STAMP}`);
    const vinkA = await createVink(appFlagOn, organizer.token); // organizer's own, created first
    const vinkB = await createVink(appFlagOn, organizer.token); // organizer's own, created second
    await addMember(appFlagOn, organizer.token, vinkA.id, member.username);
    await addMember(appFlagOn, organizer.token, vinkB.id, member.username);

    const memberList = await appFlagOn.inject({
      method: 'GET',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${member.token}` },
    });
    const ids = (memberList.json().vinks as Array<{ id: string }>).map((v) => v.id);
    const indexA = ids.indexOf(vinkA.id);
    const indexB = ids.indexOf(vinkB.id);
    assert.ok(indexB < indexA, 'the more recently created vink must sort first');
  });

  it('authenticated-user isolation: a stranger to both vinks sees neither', async () => {
    const organizer = await register(appFlagOn, `i2bisoo${STAMP}`);
    const stranger = await register(appFlagOn, `i2bisos${STAMP}`);
    const vink = await createVink(appFlagOn, organizer.token);

    const strangerList = await appFlagOn.inject({
      method: 'GET',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${stranger.token}` },
    });
    const strangerVinks = strangerList.json().vinks as Array<Record<string, unknown>>;
    assert.ok(!strangerVinks.some((v) => v.id === vink.id));
  });

  it('participant-view: a stranger (never added) gets 403, never the vink data', async () => {
    const organizer = await register(appFlagOn, `i2bpvfo${STAMP}`);
    const stranger = await register(appFlagOn, `i2bpvfs${STAMP}`);
    const vink = await createVink(appFlagOn, organizer.token);

    const response = await appFlagOn.inject({
      method: 'GET',
      url: `/api/v1/vinks/${vink.id}/participant-view`,
      headers: { authorization: `Bearer ${stranger.token}` },
    });
    assert.equal(response.statusCode, 403);
  });

  it('participant-view is gated off (404) when the flag is off', async () => {
    const organizer = await register(appFlagOff, `i2bpvoo${STAMP}`);
    const member = await register(appFlagOff, `i2bpvom${STAMP}`);
    const vink = await createVink(appFlagOff, organizer.token);
    await addMember(appFlagOff, organizer.token, vink.id, member.username);

    const response = await appFlagOff.inject({
      method: 'GET',
      url: `/api/v1/vinks/${vink.id}/participant-view`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    assert.equal(response.statusCode, 404);
  });

  it('participant-activity is gated off (404) when the flag is off', async () => {
    const organizer = await register(appFlagOff, `i2dpaoo${STAMP}`);
    const member = await register(appFlagOff, `i2dpaom${STAMP}`);
    const vink = await createVink(appFlagOff, organizer.token);
    await addMember(appFlagOff, organizer.token, vink.id, member.username);

    const response = await appFlagOff.inject({
      method: 'GET',
      url: `/api/v1/vinks/${vink.id}/participant-activity`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    assert.equal(response.statusCode, 404);
  });

  it(
    "Slice I2D, real PostgreSQL: a participant's activity feed shows vink-wide milestones and " +
      "their own contribution, but never a fellow participant's contribution event",
    async () => {
      const organizer = await register(appFlagOn, `i2dpaeo${STAMP}`);
      const memberA = await register(appFlagOn, `i2dpaea${STAMP}`);
      const memberB = await register(appFlagOn, `i2dpaeb${STAMP}`);
      const vink = await createVink(appFlagOn, organizer.token);
      await addMember(appFlagOn, organizer.token, vink.id, memberA.username);
      await addMember(appFlagOn, organizer.token, vink.id, memberB.username);
      await openVink(appFlagOn, organizer.token, vink.id);

      const authA = await appFlagOn.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vink.id}/contributions/authorize`,
        headers: { authorization: `Bearer ${memberA.token}` },
      });
      assert.equal(authA.statusCode, 200, `memberA authorize failed: ${authA.body}`);
      const authB = await appFlagOn.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vink.id}/contributions/authorize`,
        headers: { authorization: `Bearer ${memberB.token}` },
      });
      assert.equal(authB.statusCode, 200, `memberB authorize failed: ${authB.body}`);

      const response = await appFlagOn.inject({
        method: 'GET',
        url: `/api/v1/vinks/${vink.id}/participant-activity`,
        headers: { authorization: `Bearer ${memberA.token}` },
      });
      assert.equal(response.statusCode, 200, `participant-activity failed: ${response.body}`);
      const entries = response.json() as Array<{ kind: string; detail: Record<string, unknown> }>;
      const eventTypes = entries.map((entry) => entry.detail.eventType);

      assert.ok(eventTypes.includes('VinkOpened'), 'vink-wide milestone present');
      assert.equal(
        eventTypes.filter((t) => t === 'ContributionAuthorized').length,
        1,
        "exactly one — memberA's own, never memberB's",
      );
      assert.ok(
        entries.every((entry) => entry.kind === 'event'),
        'no transition rows leaked',
      );
      assert.ok(
        entries.every((entry) => Object.keys(entry.detail).length === 1),
        'every entry sanitized to {eventType} only',
      );
    },
  );

  it('details is gated off (404) when the flag is off', async () => {
    const organizer = await register(appFlagOff, `i6dtloo${STAMP}`);
    const vink = await createVink(appFlagOff, organizer.token);

    const response = await appFlagOff.inject({
      method: 'GET',
      url: `/api/v1/vinks/${vink.id}/details`,
      headers: { authorization: `Bearer ${organizer.token}` },
    });
    assert.equal(response.statusCode, 404);
  });

  it(
    'Slice I6 (D43), real PostgreSQL: organizer sees an aggregate-only summary; a participant ' +
      "sees only their own share/outcome — neither ever sees another participant's identity or amount",
    async () => {
      const organizer = await register(appFlagOn, `i6dtleo${STAMP}`);
      const memberA = await register(appFlagOn, `i6dtlea${STAMP}`);
      const memberB = await register(appFlagOn, `i6dtleb${STAMP}`);
      const vink = await createVink(appFlagOn, organizer.token);
      await addMember(appFlagOn, organizer.token, vink.id, memberA.username);
      await addMember(appFlagOn, organizer.token, vink.id, memberB.username);
      await openVink(appFlagOn, organizer.token, vink.id);

      const organizerView = await appFlagOn.inject({
        method: 'GET',
        url: `/api/v1/vinks/${vink.id}/details`,
        headers: { authorization: `Bearer ${organizer.token}` },
      });
      assert.equal(
        organizerView.statusCode,
        200,
        `organizer /details failed: ${organizerView.body}`,
      );
      const organizerBody = organizerView.json() as Record<string, unknown>;
      assert.equal(organizerBody.viewerRole, 'organizer');
      assert.equal(organizerBody.viewerParticipant, null);
      assert.ok(!('participants' in organizerBody), 'D43: no per-participant array, ever');
      assert.ok(
        !JSON.stringify(organizerBody).includes(memberA.username),
        "D43: not even the organizer sees a participant's identity on this screen",
      );

      const memberView = await appFlagOn.inject({
        method: 'GET',
        url: `/api/v1/vinks/${vink.id}/details`,
        headers: { authorization: `Bearer ${memberA.token}` },
      });
      assert.equal(memberView.statusCode, 200, `member /details failed: ${memberView.body}`);
      const memberBody = memberView.json() as Record<string, unknown>;
      assert.equal(memberBody.viewerRole, 'participant');
      assert.ok(memberBody.viewerParticipant, "memberA's own viewerParticipant block is present");
      assert.ok(
        !JSON.stringify(memberBody).includes(memberB.username),
        "D43: memberB's identity never reaches memberA's view",
      );

      const strangerView = await appFlagOn.inject({
        method: 'GET',
        url: `/api/v1/vinks/${vink.id}/details`,
        headers: {
          authorization: `Bearer ${(await register(appFlagOn, `i6dtles${STAMP}`)).token}`,
        },
      });
      assert.equal(strangerView.statusCode, 403);
    },
  );

  it(
    "participant-private data is not exposed via the list: a fellow participant's " +
      'individual allocation/status never appears on the vink-list entry',
    async () => {
      const organizer = await register(appFlagOn, `i2bprio${STAMP}`);
      const memberA = await register(appFlagOn, `i2bpria${STAMP}`);
      const memberB = await register(appFlagOn, `i2bprib${STAMP}`);
      const vink = await createVink(appFlagOn, organizer.token);
      await addMember(appFlagOn, organizer.token, vink.id, memberA.username);
      await addMember(appFlagOn, organizer.token, vink.id, memberB.username);

      const listResponse = await appFlagOn.inject({
        method: 'GET',
        url: '/api/v1/vinks',
        headers: { authorization: `Bearer ${memberA.token}` },
      });
      const entry = (listResponse.json().vinks as Array<Record<string, unknown>>).find(
        (v) => v.id === vink.id,
      )!;
      const serialized = JSON.stringify(entry);
      assert.ok(
        !serialized.includes(memberB.username),
        'no other participant identity on a list row',
      );
      assert.ok(
        !('participants' in entry),
        'the list DTO never carries a per-participant array at all',
      );
    },
  );

  it(
    "END-TO-END REGRESSION (I2B's own named exit condition): a registered member added to " +
      "another organizer's vink, with the flag enabled, discovers the vink via the " +
      'participant-inclusive list and successfully opens the participant-view experience — ' +
      'without being the organizer, and without hitting the organizer-only snapshot route',
    async () => {
      const organizer = await register(appFlagOn, `i2be2eo${STAMP}`);
      const member = await register(appFlagOn, `i2be2em${STAMP}`);
      const vink = await createVink(appFlagOn, organizer.token);
      await addMember(appFlagOn, organizer.token, vink.id, member.username);
      await openVink(appFlagOn, organizer.token, vink.id);

      // Step 1 — discover: the member's own vinks list includes it, tagged 'participant'.
      const list = await appFlagOn.inject({
        method: 'GET',
        url: '/api/v1/vinks',
        headers: { authorization: `Bearer ${member.token}` },
      });
      const entry = (list.json().vinks as Array<Record<string, unknown>>).find(
        (v) => v.id === vink.id,
      );
      assert.ok(entry, 'member must discover the vink in their own list');
      assert.equal(entry!.role, 'participant');

      // Step 2 — confirm the organizer-only route correctly still refuses this member (the
      // route this member must NOT be routed through client-side).
      const organizerRoute = await appFlagOn.inject({
        method: 'GET',
        url: `/api/v1/vinks/${vink.id}`,
        headers: { authorization: `Bearer ${member.token}` },
      });
      assert.equal(organizerRoute.statusCode, 403);

      // Step 3 — open: the member opens the actual participant experience via the correct,
      // customer-safe route, and it works.
      const participantView = await appFlagOn.inject({
        method: 'GET',
        url: `/api/v1/vinks/${vink.id}/participant-view`,
        headers: { authorization: `Bearer ${member.token}` },
      });
      assert.equal(
        participantView.statusCode,
        200,
        `participant-view failed: ${participantView.body}`,
      );
      const body = participantView.json();
      assert.equal(body.participant.displayName, member.username);
      assert.equal(body.vink.vinkOutcome, 'open');
    },
  );
});
