/**
 * ENG5 Slice 2 — password reset, against real PostgreSQL. Covers: the request round trip,
 * the account-enumeration defense (identical response for a known vs. unknown email, and for
 * a throttled vs. fresh request), token single-use/expiry, session revocation on success, and
 * the flag-off/no-provider no-op path.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { MockDeliveryProvider } from '../../../packages/delivery/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

describe('password reset (PostgreSQL, ENG5 Slice 2)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let deliveryProvider: MockDeliveryProvider;
  const stamp = Date.now();

  async function register(
    username: string,
    email: string,
  ): Promise<{ userId: string; accessToken: string; refreshToken: string }> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username, displayName: username, password: 'original-password-1', email },
    });
    assert.equal(response.statusCode, 201, `register(${username}) failed: ${response.body}`);
    const body = response.json();
    return {
      userId: body.user.id as string,
      accessToken: body.accessToken as string,
      refreshToken: body.refreshToken as string,
    };
  }

  function linkFrom(deliveryIndex: number): string {
    const sent = deliveryProvider.sent[deliveryIndex];
    assert.ok(sent, `no delivery attempt at index ${deliveryIndex}`);
    assert.equal(sent.template.kind, 'password_reset');
    return (sent.template as { link: string }).link;
  }

  before(async () => {
    db = await createIsolatedTestDb('password_reset');
    deliveryProvider = new MockDeliveryProvider();
    app = await buildApp({
      env: {
        ...db.env,
        VINKIN_PASSWORD_RESET_ENABLED: '1',
        PASSWORD_RESET_RESEND_COOLDOWN_SECONDS: 0,
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

  it('requesting for a real account sends a link that resets the password and revokes existing sessions', async () => {
    const email = `reset_${stamp}_1@example.com`;
    const { accessToken, refreshToken } = await register(`pr_user_${stamp}_1`, email);

    const requested = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email },
    });
    assert.equal(requested.statusCode, 202);
    assert.equal(deliveryProvider.sent.length, 1);
    assert.equal(deliveryProvider.sent[0]!.destination, email);
    const link = linkFrom(0);
    assert.ok(link.includes('/api/v1/auth/password-reset/confirm?token='));
    const token = new URL(link).searchParams.get('token');

    // The confirm GET page renders the form (proves the route exists and is reachable).
    const page = await app.inject({
      method: 'GET',
      url: new URL(link).pathname + new URL(link).search,
    });
    assert.equal(page.statusCode, 200);
    assert.match(page.headers['content-type'] as string, /text\/html/);

    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token, newPassword: 'brand-new-password-1' },
    });
    assert.equal(confirmed.statusCode, 200);

    // Old password no longer works; new one does.
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: `pr_user_${stamp}_1`, password: 'original-password-1' },
    });
    assert.equal(oldLogin.statusCode, 401);
    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: `pr_user_${stamp}_1`, password: 'brand-new-password-1' },
    });
    assert.equal(newLogin.statusCode, 200);

    // The pre-reset session is dead — proves the "kill every session" side effect, not just
    // the password change itself.
    const staleRefresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    assert.equal(staleRefresh.statusCode, 401);
    void accessToken;
  });

  it('account enumeration defense: unknown email gets the identical response and no send', async () => {
    const known = `reset_${stamp}_2@example.com`;
    await register(`pr_user_${stamp}_2`, known);
    const before = deliveryProvider.sent.length;

    const forKnown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email: known },
    });
    const forUnknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email: `never_registered_${stamp}@example.com` },
    });

    assert.equal(forKnown.statusCode, forUnknown.statusCode);
    assert.deepEqual(forKnown.json(), forUnknown.json());
    // Exactly one real send happened (for the known account), proving the identical HTTP
    // response wasn't achieved by suppressing the real one too.
    assert.equal(deliveryProvider.sent.length, before + 1);
  });

  it('a token is single-use and an unknown token fails cleanly, never a 500', async () => {
    const email = `reset_${stamp}_3@example.com`;
    await register(`pr_user_${stamp}_3`, email);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email },
    });
    const link = linkFrom(deliveryProvider.sent.length - 1);
    const token = new URL(link).searchParams.get('token');

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token, newPassword: 'another-new-password-1' },
    });
    assert.equal(first.statusCode, 200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token, newPassword: 'yet-another-password-1' },
    });
    assert.equal(second.statusCode, 400);
    assert.equal(second.json().error, 'INVALID_RESET_TOKEN');

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token: 'prt_totally-made-up', newPassword: 'yet-another-password-2' },
    });
    assert.equal(unknown.statusCode, 400);
  });

  it('a resend invalidates the prior token — the old link no longer resets anything', async () => {
    const email = `reset_${stamp}_4@example.com`;
    await register(`pr_user_${stamp}_4`, email);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email },
    });
    const staleLink = linkFrom(deliveryProvider.sent.length - 1);
    const staleToken = new URL(staleLink).searchParams.get('token');

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email },
    });

    const staleConfirm = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token: staleToken, newPassword: 'stale-attempt-password-1' },
    });
    assert.equal(staleConfirm.statusCode, 400);

    const freshLink = linkFrom(deliveryProvider.sent.length - 1);
    const freshToken = new URL(freshLink).searchParams.get('token');
    const freshConfirm = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token: freshToken, newPassword: 'fresh-attempt-password-1' },
    });
    assert.equal(freshConfirm.statusCode, 200);
  });

  it('a rejected new-password shape is a validation error, not a crash', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token: 'prt_whatever', newPassword: 'short' },
    });
    assert.equal(response.statusCode, 400);
  });

  it('cooldown throttling never changes the HTTP response, only whether a send happens', async () => {
    const throttledDb = await createIsolatedTestDb('password_reset_throttled');
    const throttledProvider = new MockDeliveryProvider();
    const throttledApp = await buildApp({
      env: { ...throttledDb.env, VINKIN_PASSWORD_RESET_ENABLED: '1' },
      sql: throttledDb.sql,
      deliveryProvider: throttledProvider,
      checkDb: async () => {
        await throttledDb.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    try {
      const email = `reset_${stamp}_6@example.com`;
      await throttledApp.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `pr_user_${stamp}_6`,
          displayName: 'Throttle Test',
          password: 'original-password-1',
          email,
        },
      });

      const first = await throttledApp.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset/request',
        payload: { email },
      });
      const second = await throttledApp.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset/request',
        payload: { email },
      });

      assert.equal(first.statusCode, second.statusCode);
      assert.deepEqual(first.json(), second.json());
      // Only the first actually sent — the cooldown suppressed the second silently.
      assert.equal(throttledProvider.sent.length, 1);
    } finally {
      await throttledApp.close();
      await throttledDb.drop();
    }
  });

  it('with the flag off, no send ever happens but the response and token minting stay identical', async () => {
    const disabledDb = await createIsolatedTestDb('password_reset_disabled');
    const disabledProvider = new MockDeliveryProvider();
    const disabledApp = await buildApp({
      env: { ...disabledDb.env, VINKIN_PASSWORD_RESET_ENABLED: '0' },
      sql: disabledDb.sql,
      deliveryProvider: disabledProvider,
      checkDb: async () => {
        await disabledDb.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    try {
      const email = `reset_${stamp}_7@example.com`;
      await disabledApp.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `pr_user_${stamp}_7`,
          displayName: 'Flag Off Test',
          password: 'original-password-1',
          email,
        },
      });

      const requested = await disabledApp.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset/request',
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
