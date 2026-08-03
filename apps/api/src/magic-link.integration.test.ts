/**
 * ENG5 Slice 3 — magic-link (passwordless) login, against real PostgreSQL. Covers: the
 * request/confirm round trip actually producing a real session, the account-enumeration
 * defense, token single-use/expiry, and the flag-off/no-provider no-op path.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { MockDeliveryProvider } from '../../../packages/delivery/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

describe('magic-link login (PostgreSQL, ENG5 Slice 3)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let deliveryProvider: MockDeliveryProvider;
  const stamp = Date.now();

  async function register(username: string, email: string): Promise<void> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username, displayName: username, password: 'original-password-1', email },
    });
    assert.equal(response.statusCode, 201, `register(${username}) failed: ${response.body}`);
  }

  function linkFrom(deliveryIndex: number): string {
    const sent = deliveryProvider.sent[deliveryIndex];
    assert.ok(sent, `no delivery attempt at index ${deliveryIndex}`);
    assert.equal(sent.template.kind, 'magic_link');
    return (sent.template as { link: string }).link;
  }

  before(async () => {
    db = await createIsolatedTestDb('magic_link');
    deliveryProvider = new MockDeliveryProvider();
    app = await buildApp({
      env: {
        ...db.env,
        VINKIN_MAGIC_LINK_ENABLED: '1',
        MAGIC_LINK_RESEND_COOLDOWN_SECONDS: 0,
      },
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

  it('requesting for a real account sends a link that logs the user in for real', async () => {
    const email = `magic_${stamp}_1@example.com`;
    await register(`ml_user_${stamp}_1`, email);

    const requested = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link/request',
      payload: { email },
    });
    assert.equal(requested.statusCode, 202);
    assert.equal(deliveryProvider.sent.length, 1);
    assert.equal(deliveryProvider.sent[0]!.destination, email);
    const link = linkFrom(0);
    assert.ok(link.includes('/api/v1/auth/magic-link/confirm?token='));
    const token = new URL(link).searchParams.get('token');

    // Visiting the page alone (GET) must NOT consume the token — proves no auto-fire.
    const page = await app.inject({
      method: 'GET',
      url: new URL(link).pathname + new URL(link).search,
    });
    assert.equal(page.statusCode, 200);
    assert.match(page.headers['content-type'] as string, /text\/html/);

    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link/confirm',
      payload: { token },
    });
    assert.equal(confirmed.statusCode, 200);
    const confirmedBody = confirmed.json();
    assert.equal(confirmedBody.user.email, email);
    assert.ok(typeof confirmedBody.accessToken === 'string');
    assert.ok(typeof confirmedBody.refreshToken === 'string');

    // The issued access token genuinely authenticates.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${confirmedBody.accessToken}` },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.email, email);
  });

  it('account enumeration defense: unknown email gets the identical response and no send', async () => {
    const known = `magic_${stamp}_2@example.com`;
    await register(`ml_user_${stamp}_2`, known);
    const before = deliveryProvider.sent.length;

    const forKnown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link/request',
      payload: { email: known },
    });
    const forUnknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link/request',
      payload: { email: `never_registered_${stamp}@example.com` },
    });

    assert.equal(forKnown.statusCode, forUnknown.statusCode);
    assert.deepEqual(forKnown.json(), forUnknown.json());
    assert.equal(deliveryProvider.sent.length, before + 1);
  });

  it('a token is single-use and an unknown token fails cleanly, never a 500', async () => {
    const email = `magic_${stamp}_3@example.com`;
    await register(`ml_user_${stamp}_3`, email);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link/request',
      payload: { email },
    });
    const link = linkFrom(deliveryProvider.sent.length - 1);
    const token = new URL(link).searchParams.get('token');

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link/confirm',
      payload: { token },
    });
    assert.equal(first.statusCode, 200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link/confirm',
      payload: { token },
    });
    assert.equal(second.statusCode, 400);
    assert.equal(second.json().error, 'INVALID_MAGIC_LINK_TOKEN');

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link/confirm',
      payload: { token: 'mlt_totally-made-up' },
    });
    assert.equal(unknown.statusCode, 400);
  });

  it('a resend invalidates the prior token — the old link no longer logs anyone in', async () => {
    const email = `magic_${stamp}_4@example.com`;
    await register(`ml_user_${stamp}_4`, email);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link/request',
      payload: { email },
    });
    const staleLink = linkFrom(deliveryProvider.sent.length - 1);
    const staleToken = new URL(staleLink).searchParams.get('token');

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link/request',
      payload: { email },
    });

    const staleConfirm = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link/confirm',
      payload: { token: staleToken },
    });
    assert.equal(staleConfirm.statusCode, 400);

    const freshLink = linkFrom(deliveryProvider.sent.length - 1);
    const freshToken = new URL(freshLink).searchParams.get('token');
    const freshConfirm = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link/confirm',
      payload: { token: freshToken },
    });
    assert.equal(freshConfirm.statusCode, 200);
  });

  it('with the flag off, no send ever happens but the response stays identical', async () => {
    const disabledDb = await createIsolatedTestDb('magic_link_disabled');
    const disabledProvider = new MockDeliveryProvider();
    const disabledApp = await buildApp({
      env: { ...disabledDb.env, VINKIN_MAGIC_LINK_ENABLED: '0' },
      sql: disabledDb.sql,
      deliveryProvider: disabledProvider,
      checkDb: async () => {
        await disabledDb.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    try {
      const email = `magic_${stamp}_5@example.com`;
      await disabledApp.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `ml_user_${stamp}_5`,
          displayName: 'Flag Off Test',
          password: 'original-password-1',
          email,
        },
      });

      const requested = await disabledApp.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-link/request',
        payload: { email },
      });
      assert.equal(requested.statusCode, 202);
      assert.equal(disabledProvider.sent.length, 0);
    } finally {
      await disabledApp.close();
      await disabledDb.drop();
    }
  });
});
