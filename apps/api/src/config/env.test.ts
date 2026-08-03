import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_JWT_SECRET, loadEnv } from './env.ts';
import { DEFAULT_OPEN_DURATION_SECONDS } from '../../../../packages/application/src/commands.ts';

describe('environment configuration', () => {
  it('applies development defaults to an empty environment', () => {
    const env = loadEnv({});
    assert.equal(env.VINKIN_ENV, 'development');
    assert.equal(env.PORT, 3000);
    assert.equal(env.JWT_SECRET, DEV_JWT_SECRET);
  });

  it("RM4A (D47): VINK_OPEN_DURATION_SECONDS default matches packages/application/src/commands.ts own DEFAULT_OPEN_DURATION_SECONDS — the two copies (application can't depend on apps/api) must never silently diverge", () => {
    assert.equal(loadEnv({}).VINK_OPEN_DURATION_SECONDS, DEFAULT_OPEN_DURATION_SECONDS);
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

  // ENG5 Slice 1 — same boot-refusal discipline, same reason, as the invitation-delivery
  // flag immediately above.
  it('refuses VINKIN_EMAIL_VERIFICATION_ENABLED outside development/test', () => {
    for (const environment of ['staging', 'production', 'demo']) {
      assert.throws(
        () =>
          loadEnv({
            VINKIN_ENV: environment,
            VINKIN_EMAIL_VERIFICATION_ENABLED: '1',
            ...(environment === 'production' || environment === 'staging'
              ? { JWT_SECRET: 'a-genuinely-configured-secret-value-123' }
              : {}),
            ...(environment === 'demo' ? { OPERATOR_PASSWORD: 'a-genuinely-configured-pw' } : {}),
          }),
        /VINKIN_EMAIL_VERIFICATION_ENABLED must stay off/,
      );
    }
    for (const environment of ['development', 'test']) {
      const env = loadEnv({
        VINKIN_ENV: environment,
        VINKIN_EMAIL_VERIFICATION_ENABLED: '1',
      });
      assert.equal(env.VINKIN_EMAIL_VERIFICATION_ENABLED, '1');
    }
  });

  it('applies email-verification config defaults', () => {
    const env = loadEnv({});
    assert.equal(env.EMAIL_VERIFICATION_TOKEN_TTL_SECONDS, 86_400);
    assert.equal(env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS, 60);
    assert.equal(env.VINKIN_API_PUBLIC_BASE_URL, 'http://localhost:3000');
  });
});
