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
});
