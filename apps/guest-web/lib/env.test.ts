import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_API_BASE_URL, loadEnv } from './env.ts';

describe('guest-web environment configuration (ENG4 Slice 1)', () => {
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
      NEXT_PUBLIC_API_BASE_URL: 'https://guest.vinkin.example',
    });
    assert.equal(env.VINKIN_ENV, 'production');
  });

  it('allows the loopback default in development and test', () => {
    for (const environment of ['development', 'test']) {
      assert.equal(loadEnv({ VINKIN_ENV: environment }).NEXT_PUBLIC_API_BASE_URL, DEV_API_BASE_URL);
    }
  });

  it('rejects an invalid NEXT_PUBLIC_GUEST_CONTRIBUTION_STATUS_UI value', () => {
    assert.throws(() => loadEnv({ NEXT_PUBLIC_GUEST_CONTRIBUTION_STATUS_UI: 'yes' }));
    assert.equal(
      loadEnv({ NEXT_PUBLIC_GUEST_CONTRIBUTION_STATUS_UI: '1' }).VINKIN_ENV,
      'development',
    );
  });

  it('accepts an empty NEXT_PUBLIC_SUPPORT_CONTACT_URL (withheld) or a real URL', () => {
    assert.equal(
      loadEnv({ NEXT_PUBLIC_SUPPORT_CONTACT_URL: '' }).NEXT_PUBLIC_SUPPORT_CONTACT_URL,
      '',
    );
    assert.equal(
      loadEnv({ NEXT_PUBLIC_SUPPORT_CONTACT_URL: 'https://support.vinkin.example' })
        .NEXT_PUBLIC_SUPPORT_CONTACT_URL,
      'https://support.vinkin.example',
    );
    assert.throws(() => loadEnv({ NEXT_PUBLIC_SUPPORT_CONTACT_URL: 'not-a-url' }));
  });
});
