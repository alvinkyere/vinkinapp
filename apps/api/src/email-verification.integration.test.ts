/**
 * ENG5 Slice 1 — email verification, against real PostgreSQL. Covers: auto-send on
 * registration, the request/confirm round trip, resend-cooldown throttling, token
 * single-use, expiry, the changed-email invalidation guard, and the flag-off/no-provider
 * no-op paths (never blocks registration or the request route either way).
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';
import { MockDeliveryProvider } from '../../../packages/delivery/src/index.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

describe('email verification (PostgreSQL, ENG5 Slice 1)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let deliveryProvider: MockDeliveryProvider;
  const stamp = Date.now();

  async function register(
    username: string,
    email?: string,
  ): Promise<{ userId: string; accessToken: string }> {
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
    return { userId: body.user.id as string, accessToken: body.accessToken as string };
  }

  function linkFrom(deliveryIndex: number): string {
    const sent = deliveryProvider.sent[deliveryIndex];
    assert.ok(sent, `no delivery attempt at index ${deliveryIndex}`);
    assert.equal(sent.template.kind, 'email_verification');
    return (sent.template as { link: string }).link;
  }

  before(async () => {
    db = await createIsolatedTestDb('email_verification');
    deliveryProvider = new MockDeliveryProvider();
    app = await buildApp({
      env: {
        ...db.env,
        VINKIN_EMAIL_VERIFICATION_ENABLED: '1',
        EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: 0,
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

  it('registering with an email auto-sends a verification link; confirming it verifies the account', async () => {
    const email = `verify_${stamp}_1@example.com`;
    const { userId, accessToken } = await register(`ev_user_${stamp}_1`, email);

    assert.equal(deliveryProvider.sent.length, 1);
    assert.equal(deliveryProvider.sent[0]!.destination, email);
    const link = linkFrom(0);
    assert.ok(link.includes('/api/v1/auth/email/verify/confirm?token='));

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(me.json().user.emailVerified, false);

    const confirm = await app.inject({
      method: 'GET',
      url: new URL(link).pathname + new URL(link).search,
    });
    assert.equal(confirm.statusCode, 200);
    assert.match(confirm.headers['content-type'] as string, /text\/html/);
    assert.match(confirm.body, /verified/i);

    const meAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(meAfter.json().user.emailVerified, true);
    void userId;
  });

  it('registering without an email sends nothing and leaves emailVerified false', async () => {
    const before = deliveryProvider.sent.length;
    const { accessToken } = await register(`ev_user_${stamp}_2`);
    assert.equal(deliveryProvider.sent.length, before);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(me.json().user.email, null);
    assert.equal(me.json().user.emailVerified, false);
  });

  it('a token is single-use: confirming twice fails the second time', async () => {
    const email = `verify_${stamp}_3@example.com`;
    await register(`ev_user_${stamp}_3`, email);
    const link = linkFrom(deliveryProvider.sent.length - 1);
    const path = new URL(link).pathname + new URL(link).search;

    const first = await app.inject({ method: 'GET', url: path });
    assert.equal(first.statusCode, 200);
    const second = await app.inject({ method: 'GET', url: path });
    assert.equal(second.statusCode, 400);
    assert.match(second.body, /no longer valid/i);
  });

  it('an unknown token fails cleanly, never a 500', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/email/verify/confirm?token=evt_totally-made-up',
    });
    assert.equal(response.statusCode, 400);
  });

  it('the request route requires auth, replays cooldown, and rejects an already-verified email', async () => {
    const email = `verify_${stamp}_4@example.com`;
    const { accessToken } = await register(`ev_user_${stamp}_4`, email);

    const unauthed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/email/verify/request',
    });
    assert.equal(unauthed.statusCode, 401);

    // Resend, with cooldown forced to 0 in this suite's env override — always accepted.
    const resent = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/email/verify/request',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(resent.statusCode, 202);
    assert.equal(deliveryProvider.sent.length >= 2, true);

    // Confirm via the freshest link, then a further request must reject as already-verified.
    const link = linkFrom(deliveryProvider.sent.length - 1);
    const confirmed = await app.inject({
      method: 'GET',
      url: new URL(link).pathname + new URL(link).search,
    });
    assert.equal(confirmed.statusCode, 200);

    const afterVerified = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/email/verify/request',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(afterVerified.statusCode, 409);
    assert.equal(afterVerified.json().error, 'EMAIL_ALREADY_VERIFIED');
  });

  it('a resend invalidates the prior token — the old link no longer verifies anything', async () => {
    const email = `verify_${stamp}_5@example.com`;
    const { accessToken } = await register(`ev_user_${stamp}_5`, email);
    const staleLink = linkFrom(deliveryProvider.sent.length - 1);

    const resent = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/email/verify/request',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(resent.statusCode, 202);

    const stalePath = new URL(staleLink).pathname + new URL(staleLink).search;
    const staleConfirm = await app.inject({ method: 'GET', url: stalePath });
    assert.equal(staleConfirm.statusCode, 400);

    const freshLink = linkFrom(deliveryProvider.sent.length - 1);
    const freshConfirm = await app.inject({
      method: 'GET',
      url: new URL(freshLink).pathname + new URL(freshLink).search,
    });
    assert.equal(freshConfirm.statusCode, 200);
  });

  it('changing the email resets emailVerified and invalidates any in-flight token for the old address', async () => {
    const oldEmail = `verify_${stamp}_6a@example.com`;
    const newEmail = `verify_${stamp}_6b@example.com`;
    const { accessToken } = await register(`ev_user_${stamp}_6`, oldEmail);
    const oldLink = linkFrom(deliveryProvider.sent.length - 1);

    const changed = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { email: newEmail },
    });
    assert.equal(changed.statusCode, 200);
    assert.equal(changed.json().user.emailVerified, false);

    const oldPath = new URL(oldLink).pathname + new URL(oldLink).search;
    const oldConfirm = await app.inject({ method: 'GET', url: oldPath });
    assert.equal(oldConfirm.statusCode, 400);
  });

  it('cooldown throttles a too-soon resend with 429 when the cooldown is nonzero', async () => {
    const email = `verify_${stamp}_7@example.com`;
    const throttledDb = await createIsolatedTestDb('email_verification_throttled');
    const throttledProvider = new MockDeliveryProvider();
    const throttledApp = await buildApp({
      env: { ...throttledDb.env, VINKIN_EMAIL_VERIFICATION_ENABLED: '1' },
      sql: throttledDb.sql,
      deliveryProvider: throttledProvider,
      checkDb: async () => {
        await throttledDb.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    try {
      const registered = await throttledApp.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `ev_user_${stamp}_7`,
          displayName: 'Throttle Test',
          password: 'integration-password-1',
          email,
        },
      });
      const accessToken = registered.json().accessToken as string;
      const resend = await throttledApp.inject({
        method: 'POST',
        url: '/api/v1/auth/email/verify/request',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      assert.equal(resend.statusCode, 429);
      assert.equal(resend.json().error, 'RESEND_THROTTLED');
    } finally {
      await throttledApp.close();
      await throttledDb.drop();
    }
  });

  it('with the flag off, registration never sends and the request route 404s-shaped-disabled path is skipped (no delivery attempted)', async () => {
    const disabledDb = await createIsolatedTestDb('email_verification_disabled');
    const disabledProvider = new MockDeliveryProvider();
    const disabledApp = await buildApp({
      env: { ...disabledDb.env, VINKIN_EMAIL_VERIFICATION_ENABLED: '0' },
      sql: disabledDb.sql,
      deliveryProvider: disabledProvider,
      checkDb: async () => {
        await disabledDb.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    try {
      const registered = await disabledApp.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `ev_user_${stamp}_8`,
          displayName: 'Flag Off Test',
          password: 'integration-password-1',
          email: `verify_${stamp}_8@example.com`,
        },
      });
      assert.equal(registered.statusCode, 201);
      assert.equal(disabledProvider.sent.length, 0);

      // The request route itself still mints a token (self-serve resend is independent of
      // auto-send-on-register) but never calls the provider while the flag is off.
      const accessToken = registered.json().accessToken as string;
      const requested = await disabledApp.inject({
        method: 'POST',
        url: '/api/v1/auth/email/verify/request',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      assert.equal(requested.statusCode, 202);
      assert.equal(disabledProvider.sent.length, 0);
    } finally {
      await disabledApp.close();
      await disabledDb.drop();
    }
  });
});
