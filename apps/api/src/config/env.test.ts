import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_JWT_SECRET, loadEnv } from './env.ts';

describe('environment configuration', () => {
  it('applies development defaults to an empty environment', () => {
    const env = loadEnv({});
    assert.equal(env.VINKIN_ENV, 'development');
    assert.equal(env.PORT, 3000);
    assert.equal(env.JWT_SECRET, DEV_JWT_SECRET);
  });

  it('coerces PORT and rejects invalid values', () => {
    assert.equal(loadEnv({ PORT: '8080' }).PORT, 8080);
    assert.throws(() => loadEnv({ PORT: 'not-a-port' }));
    assert.throws(() => loadEnv({ PORT: '70000' }));
  });

  it('rejects unknown VINKIN_ENV values', () => {
    assert.throws(() => loadEnv({ VINKIN_ENV: 'prod' }));
  });

  it('refuses the development JWT secret in production and staging', () => {
    for (const environment of ['production', 'staging']) {
      assert.throws(
        () => loadEnv({ VINKIN_ENV: environment }),
        /JWT_SECRET must be explicitly set/,
      );
    }
    const env = loadEnv({
      VINKIN_ENV: 'production',
      JWT_SECRET: 'a-genuinely-configured-secret-value-123',
    });
    assert.equal(env.VINKIN_ENV, 'production');
  });

  it('requires JWT_SECRET to be at least 32 characters', () => {
    assert.throws(() => loadEnv({ JWT_SECRET: 'short' }));
  });

  // Slice I4B (D38) — the required "environment enforcement" test the I4/I4B briefs both
  // named but neither had actually written yet (confirmed by grep before writing this).
  it('refuses VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED outside development/test', () => {
    for (const environment of ['staging', 'production', 'demo']) {
      assert.throws(
        () =>
          loadEnv({
            VINKIN_ENV: environment,
            VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED: '1',
            ...(environment === 'production' || environment === 'staging'
              ? { JWT_SECRET: 'a-genuinely-configured-secret-value-123' }
              : {}),
            ...(environment === 'demo' ? { OPERATOR_PASSWORD: 'a-genuinely-configured-pw' } : {}),
          }),
        /VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED must stay off/,
      );
    }
    for (const environment of ['development', 'test']) {
      const env = loadEnv({
        VINKIN_ENV: environment,
        VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED: '1',
      });
      assert.equal(env.VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED, '1');
    }
  });
});
