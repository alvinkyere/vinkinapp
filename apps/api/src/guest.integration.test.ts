/**
 * Guest join & sharing end-to-end — the PV4 exit gate ("a guest can join a Vink without
 * authentication or an installed application", journey E9's joinable half). Requires real
 * PostgreSQL; skipped unless VINKIN_INTEGRATION=1.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe('guest join & sharing end-to-end (PostgreSQL)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const organizer = `pv4_org_${Date.now()}`;
  let organizerToken: string;

  async function createOpenVink(): Promise<{ vinkId: string; publicCode: string }> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/vinks',
      headers: { authorization: `Bearer ${organizerToken}` },
      payload: {
        purchaseCategory: 'GROCERY',
        subtotalMinor: 9_000,
        tipMinor: 0,
        submissionDeadline: FUTURE,
        organizerDisplayName: 'Organizer',
      },
    });
    const vinkId = created.json().vink.id as string;
    const publicCode = created.json().vink.publicCode as string;
    // A registered member so the vink can open; the guest joins after opening.
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: { authorization: `Bearer ${organizerToken}` },
      payload: { username: organizer, displayName: 'placeholder' },
    }); // organizer already participant → 422; ignore and add real member below
    return { vinkId, publicCode };
  }

  before(async () => {
    db = await createIsolatedTestDb('guest');
    app = await buildApp({
      env: db.env,
      sql: db.sql,
      checkDb: async () => {
        await db.sql`SELECT 1`;
      },
      checkRedis: async () => {},
      publicRateLimits: {
        publicView: { windowMs: 60_000, max: 1_000 },
        publicJoin: { windowMs: 60_000, max: 1_000 },
      },
    });
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: organizer, displayName: organizer, password: 'integration-password-1' },
    });
    assert.equal(registered.statusCode, 201);
    organizerToken = registered.json().accessToken;
  });

  after(async () => {
    await app.close();
    await db.drop();
  });

  it('E9: share link → public view → guest joins without auth → guest sees own view', async () => {
    const member = `pv4_member_${Date.now()}`;
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: member, displayName: member, password: 'integration-password-1' },
    });

    const { vinkId } = await createOpenVink();
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: { authorization: `Bearer ${organizerToken}` },
      payload: { username: member },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: { authorization: `Bearer ${organizerToken}` },
      payload: { method: 'EQUAL' },
    });
    const opened = await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: { authorization: `Bearer ${organizerToken}` },
      payload: {},
    });
    assert.equal(opened.statusCode, 200);

    // Organizer mints the share link and the QR payload (auth required). ENG2: GET, not
    // POST — minting the code has no side effect, it's a query over the existing publicCode.
    const link = await app.inject({
      method: 'GET',
      url: `/api/v1/vinks/${vinkId}/share-links`,
      headers: { authorization: `Bearer ${organizerToken}` },
    });
    assert.equal(link.statusCode, 200);
    const publicCode = link.json().publicCode as string;
    assert.match(link.json().url, new RegExp(`/join/${publicCode}$`));
    const qr = await app.inject({
      method: 'GET',
      url: `/api/v1/vinks/${vinkId}/qr`,
      headers: { authorization: `Bearer ${organizerToken}` },
    });
    assert.equal(qr.json().format, 'vinkin.join.v1');
    assert.equal(qr.json().publicCode, publicCode);
    const unauthedShare = await app.inject({
      method: 'GET',
      url: `/api/v1/vinks/${vinkId}/share-links`,
    });
    assert.equal(unauthedShare.statusCode, 401);

    // Anonymous pre-join view — NO authentication anywhere below this line.
    const preJoin = await app.inject({ method: 'GET', url: `/api/v1/join/${publicCode}` });
    assert.equal(preJoin.statusCode, 200);
    assert.equal(preJoin.json().joinable, true);
    assert.equal(preJoin.json().participantCount, 2);

    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/public/vinks/${publicCode}/participants`,
      payload: { displayName: 'Walk-up Guest' },
    });
    assert.equal(joined.statusCode, 201);
    const guestToken = joined.json().guestToken as string;
    assert.match(guestToken, /^vgt_/);
    assert.equal(joined.json().participant.status, 'JOINED');

    const guestView = await app.inject({
      method: 'GET',
      url: '/api/v1/guest/session',
      headers: { authorization: `Bearer ${guestToken}` },
    });
    assert.equal(guestView.statusCode, 200);
    assert.equal(guestView.json().participant.displayName, 'Walk-up Guest');
    assert.equal(guestView.json().vink.participantCount, 3);

    // The raw token is never stored — only its hash exists in the database.
    const stored = await db.sql`SELECT access_token_hash FROM guest_identities`;
    assert.equal(
      stored.some((row) => row.access_token_hash === guestToken),
      false,
    );

    // Wrong/absent tokens fail closed.
    const badToken = await app.inject({
      method: 'GET',
      url: '/api/v1/guest/session',
      headers: { authorization: 'Bearer vgt_not-a-real-token' },
    });
    assert.equal(badToken.statusCode, 401);
    const noToken = await app.inject({ method: 'GET', url: '/api/v1/guest/session' });
    assert.equal(noToken.statusCode, 401);
  });

  it('joining is refused before open and after cancel (410), and for unknown codes (404)', async () => {
    const { vinkId, publicCode } = await createOpenVink(); // still DRAFT — no member/split/open
    const draftJoin = await app.inject({
      method: 'POST',
      url: `/api/v1/public/vinks/${publicCode}/participants`,
      payload: { displayName: 'Too Early' },
    });
    assert.equal(draftJoin.statusCode, 410);

    const member = `pv4_m2_${Date.now()}`;
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: member, displayName: member, password: 'integration-password-1' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/participants`,
      headers: { authorization: `Bearer ${organizerToken}` },
      payload: { username: member },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/vinks/${vinkId}/split`,
      headers: { authorization: `Bearer ${organizerToken}` },
      payload: { method: 'EQUAL' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/open`,
      headers: { authorization: `Bearer ${organizerToken}` },
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/vinks/${vinkId}/cancel`,
      headers: { authorization: `Bearer ${organizerToken}` },
      payload: {},
    });
    const cancelledJoin = await app.inject({
      method: 'POST',
      url: `/api/v1/public/vinks/${publicCode}/participants`,
      payload: { displayName: 'Too Late' },
    });
    assert.equal(cancelledJoin.statusCode, 410);

    const unknown = await app.inject({
      method: 'GET',
      url: '/api/v1/join/NOSUCHCODE99',
    });
    assert.equal(unknown.statusCode, 404);
  });

  it('rate-limits the public join surface (429 with retry-after)', async () => {
    const limited = await buildApp({
      env: db.env,
      sql: db.sql,
      checkDb: async () => {
        await db.sql`SELECT 1`;
      },
      checkRedis: async () => {},
      publicRateLimits: {
        publicView: { windowMs: 60_000, max: 3 },
        publicJoin: { windowMs: 60_000, max: 3 },
      },
    });
    try {
      const responses = [];
      for (let i = 0; i < 5; i += 1) {
        responses.push(await limited.inject({ method: 'GET', url: '/api/v1/join/SOMECODE123' }));
      }
      const statuses = responses.map((response) => response.statusCode);
      // First three pass the limiter (404 — unknown code), then the window closes.
      assert.deepEqual(statuses, [404, 404, 404, 429, 429]);
      assert.ok(Number(responses[4]!.headers['retry-after']) >= 1);
    } finally {
      await limited.close();
    }
  });
});
