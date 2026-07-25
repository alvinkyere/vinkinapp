import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_API_BASE_URL, loadEnv } from './env.ts';

describe('operations-console environment configuration (ENG4 Slice 1)', () => {
  it('applies development defaults to an empty environment', () => {
    const env = loadEnv({});
    assert.equal(env.VINKIN_ENV, 'development');
    assert.equal(env.NEXT_PUBLIC_API_BASE_URL, DEV_API_BASE_URL);
  });

  it('rejects unknown VINKIN_ENV values', () => {
    assert.throws(() => loadEnv({ VINKIN_ENV: 'prod' }));
  });

  it('rejects a malformed NEXT_PUBLIC_API_BASE_URL', () => {
    assert.throws(() => loadEnv({ NEXT_PUBLIC_API_BASE_URL: 'not-a-url' }));
  });

  it('refuses the loopback default in staging and production', () => {
    for (const environment of ['staging', 'production']) {
      assert.throws(
        () => loadEnv({ VINKIN_ENV: environment }),
        /NEXT_PUBLIC_API_BASE_URL must be explicitly set/,
      );
    }
    const env = loadEnv({
      VINKIN_ENV: 'production',
      NEXT_PUBLIC_API_BASE_URL: 'https://ops.vinkin.example',
    });
    assert.equal(env.VINKIN_ENV, 'production');
  });

  it('allows the loopback default in development and test', () => {
    for (const environment of ['development', 'test']) {
      assert.equal(loadEnv({ VINKIN_ENV: environment }).NEXT_PUBLIC_API_BASE_URL, DEV_API_BASE_URL);
    }
  });
});
