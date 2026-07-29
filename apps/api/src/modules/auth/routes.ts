/**
 * Auth transport (PV1). Routes validate with Zod, call the service, and map typed errors to
 * status codes — no business logic in handlers (D13).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { Sql } from '../../db/client.ts';
import type { Env } from '../../config/env.ts';
import { requireUser } from '../../auth/http.ts';
import { signAccessToken, verifyAccessToken } from '../../auth/tokens.ts';
import { makeRateLimiter, type RateLimitConfig } from '../../middleware/rate-limit.ts';
import type { DeliveryProvider } from '../../../../../packages/delivery/src/index.ts';
import { AppleIdentityError, verifyAppleIdentityToken } from '../../auth/apple-identity.ts';
import { GoogleIdentityError, verifyGoogleIdentityToken } from '../../auth/google-identity.ts';
import {
  AuthError,
  confirmEmailVerification,
  confirmMagicLink,
  confirmPasswordReset,
  createEmailVerificationToken,
  findUserById,
  lastEmailVerificationAttempt,
  loginUser,
  refreshSession,
  registerUser,
  requestMagicLink,
  requestPasswordReset,
  revokeSession,
  signInWithOAuth,
  updateContactInfo,
} from './service.ts';

export interface AuthRateLimits {
  passwordResetRequest: RateLimitConfig;
  magicLinkRequest: RateLimitConfig;
}

/** IP-based, not per-email — this is a volume brake against an unauthenticated route being
 * hammered, not the account-enumeration defense (that's the request handler always returning
 * the identical response regardless of what `requestPasswordReset`/`requestMagicLink`
 * actually did). */
export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = {
  passwordResetRequest: { windowMs: 60_000, max: 10 },
  magicLinkRequest: { windowMs: 60_000, max: 10 },
};

// Slice I4 (D19/D27): a US-only, digits-and-punctuation-tolerant phone check — deliberately
// loose (no carrier/format validation, that's a provider/legal-dependent concern, §27/§29 of
// the copy system, out of this slice's scope). Phase 6 §20's own field-level error copy
// ("That doesn't look like a valid phone number") is the route's job to surface, not this
// schema's.
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9()\-.\s]{7,20}$/);

const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9_]+$/i),
  displayName: z.string().min(1).max(80),
  email: z.email().optional(),
  phone: phoneSchema.optional(),
  password: z.string().min(10).max(200),
});

// Slice I4: every field optional/nullable — Profile only ever changes what the user actually
// edits (Register already captured whatever was provided at signup).
const updateContactSchema = z.object({
  email: z.union([z.email(), z.null()]).optional(),
  phone: z.union([phoneSchema, z.null()]).optional(),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

function authErrorStatus(code: AuthError['code']): number {
  if (code === 'USERNAME_TAKEN') return 409;
  if (code === 'NO_EMAIL_ON_FILE') return 422;
  if (code === 'EMAIL_ALREADY_VERIFIED') return 409;
  if (code === 'INVALID_VERIFICATION_TOKEN') return 400;
  if (code === 'INVALID_RESET_TOKEN') return 400;
  if (code === 'INVALID_MAGIC_LINK_TOKEN') return 400;
  if (code === 'EMAIL_ALREADY_REGISTERED') return 409;
  return 401;
}

const verifyEmailConfirmQuerySchema = z.object({ token: z.string().min(1) });

/** A verified email's link is HTML a browser opens directly — never JSON, and never behind
 * the SPA/app shell (a bare API route mirrors the pattern the D14 guest-join link already
 * uses: a plaintext bearer secret embedded in a URL an email client sends verbatim). */
function verifyEmailConfirmPage(outcome: 'ok' | 'invalid'): string {
  const heading = outcome === 'ok' ? 'Email verified' : 'This link is no longer valid';
  const body =
    outcome === 'ok'
      ? 'Your email address has been verified. You can close this tab and return to VinkIn.'
      : 'This verification link has expired or was already used. Request a new one from the app.';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${heading} — VinkIn</title></head><body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; text-align: center;"><h1>${heading}</h1><p>${body}</p></body></html>`;
}

const passwordResetRequestSchema = z.object({ email: z.email() });
const passwordResetConfirmQuerySchema = z.object({ token: z.string().min(1) });
const passwordResetConfirmBodySchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(10).max(200),
});

/**
 * ENG5 Slice 2 — unlike email verification's one-click confirm, resetting a password needs an
 * actual input (the new password), which a static page can't collect. Rather than pull in a
 * urlencoded-body parser for one route (every other route in this API is JSON-only) or invent
 * client-app deep-link handling this slice never asked for, the page is a minimal HTML form
 * whose inline script `fetch()`s the same JSON `POST .../password-reset/confirm` route the
 * mobile app itself would call — one mutation path, two front-ends (a bare browser via this
 * page, or a future in-app screen), not two.
 */
function passwordResetConfirmPage(token: string): string {
  const escapedToken = token.replace(/"/g, '&quot;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Reset your password — VinkIn</title></head><body style="font-family: system-ui, sans-serif; max-width: 24rem; margin: 4rem auto; padding: 0 1rem;">
<h1>Reset your password</h1>
<form id="f"><input type="hidden" id="token" value="${escapedToken}"><label for="pw">New password</label><br><input type="password" id="pw" minlength="10" maxlength="200" required style="width: 100%; padding: .5rem; margin: .5rem 0;"><br><button type="submit" style="padding: .5rem 1rem;">Reset password</button></form>
<p id="msg"></p>
<script>
document.getElementById('f').addEventListener('submit', async function (e) {
  e.preventDefault();
  const token = document.getElementById('token').value;
  const newPassword = document.getElementById('pw').value;
  const msg = document.getElementById('msg');
  msg.textContent = 'Working…';
  try {
    const res = await fetch('/api/v1/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token, newPassword: newPassword }),
    });
    msg.textContent = res.ok
      ? 'Password updated. You can close this tab and sign in with your new password.'
      : 'This link has expired or was already used. Request a new one from the app.';
  } catch (err) {
    msg.textContent = 'Something went wrong. Please try again.';
  }
});
</script>
</body></html>`;
}

const magicLinkRequestSchema = z.object({ email: z.email() });
const magicLinkConfirmQuerySchema = z.object({ token: z.string().min(1) });
const magicLinkConfirmBodySchema = z.object({ token: z.string().min(1) });

const appleSignInSchema = z.object({
  identityToken: z.string().min(1),
  // Only present on the account's first-ever authorization (Apple's own behavior, not this
  // schema's choice) — both optional, independently.
  givenName: z.string().optional(),
  familyName: z.string().optional(),
});

// No display-name field: Google's ID token already carries a verified `name` claim on every
// sign-in (`verifyGoogleIdentityToken` extracts it) — unlike Apple, which never includes a
// name in its identity token at all, this route has nothing to ask the client for.
const googleSignInSchema = z.object({ idToken: z.string().min(1) });

/**
 * ENG5 Slice 3 — deliberately does NOT auto-fire the confirm call on page load (unlike
 * `verifyEmailConfirmPage`, which safely can — nothing else competes to consume that token).
 * A magic-link token is single-use and this same link is meant to also work by being copied
 * out of the email and pasted into the mobile app's own "Log in with link" screen; auto-firing
 * here would silently consume it (e.g. an email client's own link-preview prefetch) before the
 * user ever gets to choose which surface completes the login. Requires an explicit button
 * click, same "no auto-submit" discipline `passwordResetConfirmPage`'s form already follows.
 * True one-tap deep-link login (skipping this page entirely) is a disclosed follow-up, blocked
 * today on ENG4 Slice 10's own open Android App Links gap — not built on top of unverified
 * infrastructure.
 */
function magicLinkConfirmPage(token: string): string {
  const escapedToken = token.replace(/"/g, '&quot;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Log in — VinkIn</title></head><body style="font-family: system-ui, sans-serif; max-width: 24rem; margin: 4rem auto; padding: 0 1rem;">
<h1>Log in to VinkIn</h1>
<p>Sign in on this browser, or copy this page's link and paste it into the VinkIn app's "Log in with link" screen instead — either way works, but only once.</p>
<input type="hidden" id="token" value="${escapedToken}">
<button id="go" style="padding: .5rem 1rem;">Sign in on this browser</button>
<p id="msg"></p>
<script>
document.getElementById('go').addEventListener('click', async function () {
  const token = document.getElementById('token').value;
  const btn = document.getElementById('go');
  const msg = document.getElementById('msg');
  btn.disabled = true;
  msg.textContent = 'Working…';
  try {
    const res = await fetch('/api/v1/auth/magic-link/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token }),
    });
    msg.textContent = res.ok
      ? "You're signed in on this browser. This link cannot be used again."
      : 'This link has expired or was already used. Request a new one from the app.';
  } catch (err) {
    msg.textContent = 'Something went wrong. Please try again.';
    btn.disabled = false;
  }
});
</script>
</body></html>`;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  env: Env,
  sql: Sql,
  deliveryProvider?: DeliveryProvider,
  authRateLimits: AuthRateLimits = DEFAULT_AUTH_RATE_LIMITS,
  /** ENG5 Slice 4 — test-only override for the Apple JWKS key resolver (defaults to Apple's
   * real remote key set when omitted). Lets an integration test exercise this ENTIRE route —
   * schema validation, the fail-closed disabled/unconfigured checks, session creation, the
   * new-vs-existing-user branch — against a genuinely signed test token, not just unit-test
   * the crypto function in isolation. Same DI pattern as `deliveryProvider`/`provider`/`hub`. */
  appleKeyResolver?: Parameters<typeof verifyAppleIdentityToken>[2],
  /** ENG5 Slice 5 — same test-only override, for Google's key resolver. */
  googleKeyResolver?: Parameters<typeof verifyGoogleIdentityToken>[2],
  /** ENG8 — Redis-backed rate-limit windows, correct across multiple API instances.
   * Undefined falls back to the original per-process in-memory windows (unit tests, local
   * dev without Redis). */
  redis?: Redis,
): void {
  const passwordResetEnabled = env.VINKIN_PASSWORD_RESET_ENABLED === '1';
  const passwordResetRequestLimiter = makeRateLimiter(
    'password-reset-request',
    authRateLimits.passwordResetRequest,
    redis,
  );
  const magicLinkEnabled = env.VINKIN_MAGIC_LINK_ENABLED === '1';
  const magicLinkRequestLimiter = makeRateLimiter(
    'magic-link-request',
    authRateLimits.magicLinkRequest,
    redis,
  );
  const emailVerificationEnabled = env.VINKIN_EMAIL_VERIFICATION_ENABLED === '1';
  const appleSignInEnabled = env.VINKIN_APPLE_SIGN_IN_ENABLED === '1';
  const googleSignInEnabled = env.VINKIN_GOOGLE_SIGN_IN_ENABLED === '1';

  /** Best-effort: mints and sends a verification email for a just-registered account that
   * supplied one. Never throws — the exact same "a delivery failure never blocks or
   * misrepresents the caller's own already-committed state" rule `dispatchGuestInvitation`
   * follows (Phase 5 §2), applied here to registration instead of invitation. */
  async function sendVerificationEmailBestEffort(userId: string): Promise<void> {
    if (deliveryProvider === undefined || !emailVerificationEnabled) return;
    try {
      const { token, email } = await createEmailVerificationToken(
        sql,
        userId,
        env.EMAIL_VERIFICATION_TOKEN_TTL_SECONDS,
      );
      const link = `${env.VINKIN_API_PUBLIC_BASE_URL.replace(/\/$/, '')}/api/v1/auth/email/verify/confirm?token=${token}`;
      await deliveryProvider.send({
        destination: email,
        method: 'EMAIL',
        template: { kind: 'email_verification', link },
      });
    } catch (error) {
      // AuthError('NO_EMAIL_ON_FILE') is expected whenever registration omitted an email —
      // not a real failure. Anything else is logged and swallowed, same as guest dispatch.
      if (!(error instanceof AuthError)) {
        app.log.error({ err: error, userId }, 'verification email dispatch failed unexpectedly');
      }
    }
  }

  app.post('/api/v1/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    try {
      const { user, sessionId, refreshToken } = await registerUser(sql, body);
      const accessToken = await signAccessToken(env.JWT_SECRET, { userId: user.id, sessionId });
      await sendVerificationEmailBestEffort(user.id);
      return reply.code(201).send({ user, accessToken, refreshToken });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(authErrorStatus(error.code)).send({ error: error.code });
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    try {
      const { user, sessionId, refreshToken } = await loginUser(sql, body);
      const accessToken = await signAccessToken(env.JWT_SECRET, { userId: user.id, sessionId });
      return reply.send({ user, accessToken, refreshToken });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(authErrorStatus(error.code)).send({ error: error.code });
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/refresh', async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    try {
      const rotated = await refreshSession(sql, body.refreshToken);
      const accessToken = await signAccessToken(env.JWT_SECRET, {
        userId: rotated.userId,
        sessionId: rotated.sessionId,
      });
      return reply.send({ accessToken, refreshToken: rotated.refreshToken });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(authErrorStatus(error.code)).send({ error: error.code });
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    await revokeSession(sql, body.refreshToken);
    return reply.code(204).send();
  });

  app.get('/api/v1/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') === true ? header.slice('Bearer '.length) : null;
    const claims = token === null ? null : await verifyAccessToken(env.JWT_SECRET, token);
    if (claims === null) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    const user = await findUserById(sql, claims.userId);
    if (user === null || user.status !== 'ACTIVE') {
      return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    }
    return reply.send({ user });
  });

  // Slice I4 (D19/D27) — Profile's own contact-editing surface. No PATCH /profile route
  // existed anywhere before this; verified by reading this module in full first.
  app.patch('/api/v1/me', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;
    const body = updateContactSchema.parse(request.body);
    const user = await updateContactInfo(sql, claims.userId, body);
    return reply.send({ user });
  });

  // ENG5 Slice 1 — self-serve resend, authenticated (only the account owner can trigger a
  // send to their own address). Best-effort cooldown throttle, same pattern and same
  // "not a hard guarantee" acknowledgment as the guest-invite resend route in
  // vinks/routes.ts — a genuinely concurrent double-request can still both pass this check;
  // `createEmailVerificationToken`'s own consume-prior-token step keeps that harmless (the
  // account ends up with exactly one live token either way, not two independently valid ones).
  app.post('/api/v1/auth/email/verify/request', async (request, reply) => {
    const claims = await requireUser(request, reply, env);
    if (claims === null) return;

    const cooldownMs = env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000;
    const last = await lastEmailVerificationAttempt(sql, claims.userId);
    if (last !== null) {
      const elapsedMs = Date.now() - last.createdAt.getTime();
      if (elapsedMs < cooldownMs) {
        return reply.code(429).send({
          error: 'RESEND_THROTTLED',
          message: `try again in ${Math.ceil((cooldownMs - elapsedMs) / 1000)}s`,
        });
      }
    }

    try {
      const { token, email } = await createEmailVerificationToken(
        sql,
        claims.userId,
        env.EMAIL_VERIFICATION_TOKEN_TTL_SECONDS,
      );
      if (deliveryProvider !== undefined && emailVerificationEnabled) {
        const link = `${env.VINKIN_API_PUBLIC_BASE_URL.replace(/\/$/, '')}/api/v1/auth/email/verify/confirm?token=${token}`;
        await deliveryProvider.send({
          destination: email,
          method: 'EMAIL',
          template: { kind: 'email_verification', link },
        });
      }
      return reply.code(202).send({ status: 'SENT' });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(authErrorStatus(error.code)).send({ error: error.code });
      }
      throw error;
    }
  });

  // Public — a browser hits this directly from the emailed link, not the app/API client.
  app.get('/api/v1/auth/email/verify/confirm', async (request, reply) => {
    const query = verifyEmailConfirmQuerySchema.parse(request.query);
    try {
      await confirmEmailVerification(sql, query.token);
      return reply.type('text/html').send(verifyEmailConfirmPage('ok'));
    } catch (error) {
      if (error instanceof AuthError && error.code === 'INVALID_VERIFICATION_TOKEN') {
        return reply.code(400).type('text/html').send(verifyEmailConfirmPage('invalid'));
      }
      throw error;
    }
  });

  // ENG5 Slice 2 — public and unauthenticated by necessity (you've forgotten your password).
  // ALWAYS returns the identical response, whether or not an account exists for `email`,
  // whether it was throttled, or whether delivery succeeded — `requestPasswordReset`'s `null`
  // covers every one of those cases uniformly so this handler never has to branch on them
  // (the account-enumeration defense; the IP rate limiter above is a separate, complementary
  // volume brake, not a substitute for it).
  app.post(
    '/api/v1/auth/password-reset/request',
    { preHandler: passwordResetRequestLimiter },
    async (request, reply) => {
      const body = passwordResetRequestSchema.parse(request.body);
      const result = await requestPasswordReset(
        sql,
        body.email,
        env.PASSWORD_RESET_TOKEN_TTL_SECONDS,
        env.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS,
      );
      if (result !== null && deliveryProvider !== undefined && passwordResetEnabled) {
        const link = `${env.VINKIN_API_PUBLIC_BASE_URL.replace(/\/$/, '')}/api/v1/auth/password-reset/confirm?token=${result.token}`;
        try {
          await deliveryProvider.send({
            destination: body.email,
            method: 'EMAIL',
            template: { kind: 'password_reset', link },
          });
        } catch (error) {
          app.log.error({ err: error }, 'password reset email dispatch failed unexpectedly');
        }
      }
      return reply.code(202).send({
        status: 'REQUESTED',
        message: 'If an account with that email exists, a reset link has been sent.',
      });
    },
  );

  // Public — a browser hits this directly from the emailed link and submits the form itself
  // (see `passwordResetConfirmPage`'s own doc comment for why this stays a plain HTML+fetch
  // page rather than a urlencoded form post).
  app.get('/api/v1/auth/password-reset/confirm', async (request, reply) => {
    const query = passwordResetConfirmQuerySchema.parse(request.query);
    return reply.type('text/html').send(passwordResetConfirmPage(query.token));
  });

  app.post('/api/v1/auth/password-reset/confirm', async (request, reply) => {
    const body = passwordResetConfirmBodySchema.parse(request.body);
    try {
      const user = await confirmPasswordReset(sql, body.token, body.newPassword);
      return reply.send({ user });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(authErrorStatus(error.code)).send({ error: error.code });
      }
      throw error;
    }
  });

  // ENG5 Slice 3 — same account-enumeration defense and same IP-rate-limit-as-volume-brake
  // shape as the password-reset request route immediately above.
  app.post(
    '/api/v1/auth/magic-link/request',
    { preHandler: magicLinkRequestLimiter },
    async (request, reply) => {
      const body = magicLinkRequestSchema.parse(request.body);
      const result = await requestMagicLink(
        sql,
        body.email,
        env.MAGIC_LINK_TOKEN_TTL_SECONDS,
        env.MAGIC_LINK_RESEND_COOLDOWN_SECONDS,
      );
      if (result !== null && deliveryProvider !== undefined && magicLinkEnabled) {
        const link = `${env.VINKIN_API_PUBLIC_BASE_URL.replace(/\/$/, '')}/api/v1/auth/magic-link/confirm?token=${result.token}`;
        try {
          await deliveryProvider.send({
            destination: body.email,
            method: 'EMAIL',
            template: { kind: 'magic_link', link },
          });
        } catch (error) {
          app.log.error({ err: error }, 'magic link email dispatch failed unexpectedly');
        }
      }
      return reply.code(202).send({
        status: 'REQUESTED',
        message: 'If an account with that email exists, a login link has been sent.',
      });
    },
  );

  // Public — see `magicLinkConfirmPage`'s own doc comment for why this requires an explicit
  // button click rather than auto-firing on page load.
  app.get('/api/v1/auth/magic-link/confirm', async (request, reply) => {
    const query = magicLinkConfirmQuerySchema.parse(request.query);
    return reply.type('text/html').send(magicLinkConfirmPage(query.token));
  });

  // Public and JSON — called either by the confirm page's own script (browser completion) or
  // directly by the mobile app after the user pastes the link/token there (in-app completion).
  // A genuine login: same response shape as register/login, not just a status flag.
  app.post('/api/v1/auth/magic-link/confirm', async (request, reply) => {
    const body = magicLinkConfirmBodySchema.parse(request.body);
    try {
      const { user, sessionId, refreshToken } = await confirmMagicLink(sql, body.token);
      const accessToken = await signAccessToken(env.JWT_SECRET, { userId: user.id, sessionId });
      return reply.send({ user, accessToken, refreshToken });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(authErrorStatus(error.code)).send({ error: error.code });
      }
      throw error;
    }
  });

  // ENG5 Slice 4 — server-side only this pass (no real Apple Developer "Sign in with Apple"
  // capability is provisioned yet, so no mobile client button calls this route today; see the
  // milestone report). Fails closed (503), not a silent no-op, whenever the feature is off OR
  // `APPLE_SIGN_IN_CLIENT_ID` is unset — accepting a token without a configured audience to
  // check it against would mean accepting a token minted for a different app.
  app.post('/api/v1/auth/oauth/apple', async (request, reply) => {
    const clientId = env.APPLE_SIGN_IN_CLIENT_ID;
    if (!appleSignInEnabled || clientId === undefined) {
      return reply.code(503).send({ error: 'APPLE_SIGN_IN_DISABLED' });
    }
    const body = appleSignInSchema.parse(request.body);
    let identity: Awaited<ReturnType<typeof verifyAppleIdentityToken>>;
    try {
      identity =
        appleKeyResolver !== undefined
          ? await verifyAppleIdentityToken(body.identityToken, clientId, appleKeyResolver)
          : await verifyAppleIdentityToken(body.identityToken, clientId);
    } catch (error) {
      if (error instanceof AppleIdentityError) {
        return reply.code(401).send({ error: 'INVALID_APPLE_TOKEN' });
      }
      throw error;
    }
    // Apple sends the name only on the account's very first authorization ever — a repeat
    // sign-in genuinely omits it, not a client bug to work around.
    const displayName =
      body.givenName !== undefined || body.familyName !== undefined
        ? [body.givenName, body.familyName].filter((part) => part !== undefined).join(' ')
        : 'VinkIn User';
    try {
      const { user, sessionId, refreshToken, isNewUser } = await signInWithOAuth(
        sql,
        'apple',
        identity.sub,
        identity.email,
        displayName,
      );
      const accessToken = await signAccessToken(env.JWT_SECRET, { userId: user.id, sessionId });
      return reply.code(isNewUser ? 201 : 200).send({ user, accessToken, refreshToken, isNewUser });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(authErrorStatus(error.code)).send({ error: error.code });
      }
      throw error;
    }
  });

  // ENG5 Slice 5 — same fail-closed shape as its Apple sibling immediately above, for the
  // identical reason: no configured `GOOGLE_SIGN_IN_CLIENT_ID` means no audience to check a
  // token against.
  app.post('/api/v1/auth/oauth/google', async (request, reply) => {
    const clientId = env.GOOGLE_SIGN_IN_CLIENT_ID;
    if (!googleSignInEnabled || clientId === undefined) {
      return reply.code(503).send({ error: 'GOOGLE_SIGN_IN_DISABLED' });
    }
    const body = googleSignInSchema.parse(request.body);
    let identity: Awaited<ReturnType<typeof verifyGoogleIdentityToken>>;
    try {
      identity =
        googleKeyResolver !== undefined
          ? await verifyGoogleIdentityToken(body.idToken, clientId, googleKeyResolver)
          : await verifyGoogleIdentityToken(body.idToken, clientId);
    } catch (error) {
      if (error instanceof GoogleIdentityError) {
        return reply.code(401).send({ error: 'INVALID_GOOGLE_TOKEN' });
      }
      throw error;
    }
    try {
      const { user, sessionId, refreshToken, isNewUser } = await signInWithOAuth(
        sql,
        'google',
        identity.sub,
        identity.email,
        identity.name ?? 'VinkIn User',
      );
      const accessToken = await signAccessToken(env.JWT_SECRET, { userId: user.id, sessionId });
      return reply.code(isNewUser ? 201 : 200).send({ user, accessToken, refreshToken, isNewUser });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(authErrorStatus(error.code)).send({ error: error.code });
      }
      throw error;
    }
  });
}
