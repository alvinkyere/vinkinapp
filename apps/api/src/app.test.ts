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
    const app = buildApp({ env, sql: null, checkDb: healthy, checkRedis: healthy });
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
    await app.close();
  });

  it('GET /health/ready reflects dependency health', async () => {
    const app = buildApp({ env, sql: null, checkDb: healthy, checkRedis: healthy });
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json(), { status: 'ready', checks: { database: 'ok', redis: 'ok' } });
    await app.close();

    const degraded = buildApp({ env, sql: null, checkDb: failing, checkRedis: healthy });
    const notReady = await degraded.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(notReady.statusCode, 503);
    assert.deepEqual(notReady.json(), {
      status: 'unavailable',
      checks: { database: 'down', redis: 'ok' },
    });
    await degraded.close();
  });

  it('every response carries an x-request-id header', async () => {
    const app = buildApp({ env, sql: null, checkDb: healthy, checkRedis: healthy });
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    assert.match(String(response.headers['x-request-id']), /^[0-9a-f-]{36}$/);
    await app.close();
  });

  it('auth routes are absent when no database is wired (unit mode)', async () => {
    const app = buildApp({ env, sql: null, checkDb: healthy, checkRedis: healthy });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'x', password: 'y' },
    });
    assert.equal(response.statusCode, 404);
    await app.close();
  });
});
