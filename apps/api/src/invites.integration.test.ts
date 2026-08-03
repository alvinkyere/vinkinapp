/**
 * Invites feature (2026-07-23, D44) against real PostgreSQL: `addParticipantCommand`'s
 * INVITED path (flag on/off), `POST .../participants/me/accept`, `POST .../participants/me/
 * decline`, and `GET /api/v1/invites` — the real-database proof of the accept/decline gate
 * and the corrected `listVinksByParticipant`/`listVinksByPendingInvite` split. Requires real
 * PostgreSQL; skipped unless VINKIN_INTEGRATION=1 (CI services).
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const STAMP = Date.now().toString(36);

describe('Invites feature (PostgreSQL, D44)', { skip: !RUN }, () => {
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
  ): Promise<{ id: string; status: string }> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: { authorization: `Bearer ${organizerToken}` },
      payload: { username },
    });
    assert.equal(response.statusCode, 201, `addMember(${username}) failed: ${response.body}`);
    return response.json() as { id: string; status: string };
  }

  before(async () => {
    db = await createIsolatedTestDb('invites_feature');
    const deps = {
      sql: db.sql,
      checkDb: async () => {
        await db.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    };
    appFlagOff = await buildApp({ ...deps, env: { ...db.env, VINKIN_INVITES_ENABLED: '0' } });
    // VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL is also on — a member's own GET /api/v1/vinks
    // only reflects their non-organizer participation at all when that separate, pre-existing
    // (Slice I2B) flag is set; without it, GET /api/v1/vinks is organizer-only regardless of
    // this feature, which would make the "accept moves it into GET /api/v1/vinks" assertion
    // meaningless rather than a real regression signal.
    appFlagOn = await buildApp({
      ...deps,
      env: {
        ...db.env,
        VINKIN_INVITES_ENABLED: '1',
        VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL: '1',
      },
    });
  });

  after(async () => {
    await appFlagOff.close();
    await appFlagOn.close();
    await db.drop();
  });

  it('flag off: an added member is JOINED immediately, and the three new routes 404', async () => {
    const organizer = await register(appFlagOff, `invoff_o_${STAMP}`);
    const member = await register(appFlagOff, `invoff_m_${STAMP}`);
    const vink = await createVink(appFlagOff, organizer.token);
    const added = await addMember(appFlagOff, organizer.token, vink.id, member.username);
    assert.equal(added.status, 'JOINED');

    const accept = await appFlagOff.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vink.id}/participants/me/accept`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    assert.equal(accept.statusCode, 404);

    const list = await appFlagOff.inject({
      method: 'GET',
      url: '/api/v1/invites',
      headers: { authorization: `Bearer ${member.token}` },
    });
    assert.equal(list.statusCode, 404);
  });

  it('flag on: an added member is INVITED, appears in GET /api/v1/invites, not in GET /api/v1/vinks', async () => {
    const organizer = await register(appFlagOn, `invon_o1_${STAMP}`);
    const member = await register(appFlagOn, `invon_m1_${STAMP}`);
    const vink = await createVink(appFlagOn, organizer.token);
    const added = await addMember(appFlagOn, organizer.token, vink.id, member.username);
    assert.equal(added.status, 'INVITED');

    const invites = await appFlagOn.inject({
      method: 'GET',
      url: '/api/v1/invites',
      headers: { authorization: `Bearer ${member.token}` },
    });
    assert.equal(invites.statusCode, 200);
    const inviteBody = invites.json() as { invites: { vinkId: string }[] };
    assert.ok(inviteBody.invites.some((i) => i.vinkId === vink.id));

    const myVinks = await appFlagOn.inject({
      method: 'GET',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${member.token}` },
    });
    const myVinksBody = myVinks.json() as { vinks: { id: string }[] };
    assert.ok(!myVinksBody.vinks.some((v) => v.id === vink.id));
  });

  it('accept moves the invite into GET /api/v1/vinks and out of GET /api/v1/invites', async () => {
    const organizer = await register(appFlagOn, `invon_o2_${STAMP}`);
    const member = await register(appFlagOn, `invon_m2_${STAMP}`);
    const vink = await createVink(appFlagOn, organizer.token);
    await addMember(appFlagOn, organizer.token, vink.id, member.username);

    const accept = await appFlagOn.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vink.id}/participants/me/accept`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    assert.equal(accept.statusCode, 200, `accept failed: ${accept.body}`);
    assert.equal(accept.json().status, 'JOINED');

    const myVinks = await appFlagOn.inject({
      method: 'GET',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${member.token}` },
    });
    assert.ok((myVinks.json() as { vinks: { id: string }[] }).vinks.some((v) => v.id === vink.id));

    const invites = await appFlagOn.inject({
      method: 'GET',
      url: '/api/v1/invites',
      headers: { authorization: `Bearer ${member.token}` },
    });
    assert.equal((invites.json() as { invites: unknown[] }).invites.length, 0);
  });

  it('decline removes the participant and reopens the split (cover-remaining needed before open)', async () => {
    const organizer = await register(appFlagOn, `invon_o3_${STAMP}`);
    const member = await register(appFlagOn, `invon_m3_${STAMP}`);
    const vink = await createVink(appFlagOn, organizer.token);
    await addMember(appFlagOn, organizer.token, vink.id, member.username);
    await appFlagOn.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vink.id}/split`,
      headers: { authorization: `Bearer ${organizer.token}` },
      payload: { method: 'EQUAL' },
    });

    const decline = await appFlagOn.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vink.id}/participants/me/decline`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    assert.equal(decline.statusCode, 200, `decline failed: ${decline.body}`);
    assert.equal(decline.json().status, 'REMOVED');

    const open = await appFlagOn.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vink.id}/open`,
      headers: { authorization: `Bearer ${organizer.token}` },
    });
    assert.equal(open.statusCode, 422, 'unallocated amount should block open until re-covered');
  });

  it('403 for a wrong actor (the organizer, or a stranger); 409 for a double-resolve', async () => {
    const organizer = await register(appFlagOn, `invon_o4_${STAMP}`);
    const member = await register(appFlagOn, `invon_m4_${STAMP}`);
    const stranger = await register(appFlagOn, `invon_s4_${STAMP}`);
    const vink = await createVink(appFlagOn, organizer.token);
    await addMember(appFlagOn, organizer.token, vink.id, member.username);

    const organizerAccept = await appFlagOn.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vink.id}/participants/me/accept`,
      headers: { authorization: `Bearer ${organizer.token}` },
    });
    assert.equal(organizerAccept.statusCode, 403);

    const strangerAccept = await appFlagOn.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vink.id}/participants/me/accept`,
      headers: { authorization: `Bearer ${stranger.token}` },
    });
    assert.equal(strangerAccept.statusCode, 403);

    const first = await appFlagOn.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vink.id}/participants/me/accept`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    assert.equal(first.statusCode, 200);
    const second = await appFlagOn.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vink.id}/participants/me/accept`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    assert.equal(second.statusCode, 409);
  });

  it('a genuinely concurrent double-accept produces exactly one JOINED transition — the database is the real guard', async () => {
    const organizer = await register(appFlagOn, `invon_o5_${STAMP}`);
    const member = await register(appFlagOn, `invon_m5_${STAMP}`);
    const vink = await createVink(appFlagOn, organizer.token);
    await addMember(appFlagOn, organizer.token, vink.id, member.username);

    const attempt = () =>
      appFlagOn.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vink.id}/participants/me/accept`,
        headers: { authorization: `Bearer ${member.token}` },
      });
    const [a, b] = await Promise.all([attempt(), attempt()]);
    const statuses = [a.statusCode, b.statusCode].sort();
    assert.deepEqual(statuses, [200, 409]);
  });
});
