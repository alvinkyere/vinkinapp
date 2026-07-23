import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';

const env = loadEnv({ VINKIN_ENV: 'test', LOG_LEVEL: 'error' });

const healthy = async () => {};
const failing = async () => {
  throw new Error('down');
};

describe('app (no infrastructure required)', () => {
  it('GET /health/live returns 200', async () => {
    const app = await buildApp({ env, sql: null, checkDb: healthy, checkRedis: healthy });
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
    await app.close();
  });

  it('GET /health/ready reflects dependency health', async () => {
    const app = await buildApp({ env, sql: null, checkDb: healthy, checkRedis: healthy });
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json(), { status: 'ready', checks: { database: 'ok', redis: 'ok' } });
    await app.close();

    const degraded = await buildApp({ env, sql: null, checkDb: failing, checkRedis: healthy });
    const notReady = await degraded.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(notReady.statusCode, 503);
    assert.deepEqual(notReady.json(), {
      status: 'unavailable',
      checks: { database: 'down', redis: 'ok' },
    });
    await degraded.close();
  });

  it('every response carries an x-request-id header', async () => {
    const app = await buildApp({ env, sql: null, checkDb: healthy, checkRedis: healthy });
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    assert.match(String(response.headers['x-request-id']), /^[0-9a-f-]{36}$/);
    await app.close();
  });

  it('auth routes are absent when no database is wired (unit mode)', async () => {
    const app = await buildApp({ env, sql: null, checkDb: healthy, checkRedis: healthy });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'x', password: 'y' },
    });
    assert.equal(response.statusCode, 404);
    await app.close();
  });

  describe('ENG3 app-version enforcement', () => {
    it('VINKIN_MINIMUM_APP_VERSION unset (the default): never enforced, any header value passes', async () => {
      const app = await buildApp({ env, sql: null, checkDb: healthy, checkRedis: healthy });
      const response = await app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { 'x-app-version': '0.0.1' },
      });
      assert.equal(response.statusCode, 200);
      await app.close();
    });

    it('a request with no x-app-version header is never enforced, even with a minimum configured', async () => {
      const gated = loadEnv({
        VINKIN_ENV: 'test',
        LOG_LEVEL: 'error',
        VINKIN_MINIMUM_APP_VERSION: '1.2.0',
      });
      const app = await buildApp({ env: gated, sql: null, checkDb: healthy, checkRedis: healthy });
      const response = await app.inject({ method: 'GET', url: '/health/live' });
      assert.equal(response.statusCode, 200);
      await app.close();
    });

    it('a client below the configured minimum gets 426, never reaching the route handler', async () => {
      const gated = loadEnv({
        VINKIN_ENV: 'test',
        LOG_LEVEL: 'error',
        VINKIN_MINIMUM_APP_VERSION: '1.2.0',
      });
      const app = await buildApp({ env: gated, sql: null, checkDb: healthy, checkRedis: healthy });
      const response = await app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { 'x-app-version': '1.1.9' },
      });
      assert.equal(response.statusCode, 426);
      assert.deepEqual(response.json(), {
        error: 'APP_VERSION_UNSUPPORTED',
        message: 'This version of VinkIn is no longer supported. Please update the app.',
      });
      await app.close();
    });

    it('a client at or above the configured minimum passes through', async () => {
      const gated = loadEnv({
        VINKIN_ENV: 'test',
        LOG_LEVEL: 'error',
        VINKIN_MINIMUM_APP_VERSION: '1.2.0',
      });
      const app = await buildApp({ env: gated, sql: null, checkDb: healthy, checkRedis: healthy });
      for (const version of ['1.2.0', '1.2.1', '2.0.0']) {
        const response = await app.inject({
          method: 'GET',
          url: '/health/live',
          headers: { 'x-app-version': version },
        });
        assert.equal(response.statusCode, 200, `expected ${version} to pass`);
      }
      await app.close();
    });

    it('a malformed x-app-version header fails open rather than blocking the request', async () => {
      const gated = loadEnv({
        VINKIN_ENV: 'test',
        LOG_LEVEL: 'error',
        VINKIN_MINIMUM_APP_VERSION: '1.2.0',
      });
      const app = await buildApp({ env: gated, sql: null, checkDb: healthy, checkRedis: healthy });
      const response = await app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { 'x-app-version': 'not-a-real-version' },
      });
      assert.equal(response.statusCode, 200);
      await app.close();
    });
  });
});
