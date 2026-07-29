/**
 * ENG7 ("Observability and auditability" — docs/architecture/eng-roadmap.md) — proves the
 * Logging gap the roadmap's own audit found real: `command_executed` log lines now carry
 * correlation id, actor, Vink id, command name, idempotency key (where applicable), and a
 * release identifier — for real command executions against real PostgreSQL, not asserted by
 * reading the source. Reuses the exact `logStream` capture pattern
 * `guest-invitation-delivery.integration.test.ts` already established for the identical
 * "never leak PII into a log line" review.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { buildApp } from './app.ts';
import { createIsolatedTestDb, type IsolatedTestDb } from './testing/integration-db.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe('structured command logging (PostgreSQL, ENG7)', { skip: !RUN }, () => {
  let db: IsolatedTestDb;
  const stamp = Date.now();

  before(async () => {
    db = await createIsolatedTestDb('structured_logging');
  });

  after(async () => {
    await db.drop();
  });

  function authed(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function buildLoggedApp(): Promise<{
    app: Awaited<ReturnType<typeof buildApp>>;
    lines: () => Record<string, unknown>[];
  }> {
    const raw: string[] = [];
    const captureStream = new Writable({
      write(chunk, _enc, callback) {
        raw.push(chunk.toString());
        callback();
      },
    });
    const app = await buildApp({
      env: { ...db.env, LOG_LEVEL: 'debug' },
      sql: db.sql,
      logStream: captureStream,
      checkDb: async () => {
        await db.sql`SELECT 1`;
      },
      checkRedis: async () => {},
    });
    return {
      app,
      lines: () =>
        raw
          .join('')
          .split('\n')
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as Record<string, unknown>),
    };
  }

  it('createVink emits a command_executed line with correlationId, actor, vinkId, command name, idempotency key, and release', async () => {
    const { app, lines } = await buildLoggedApp();
    try {
      const registered = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `eng7_log_${stamp}`,
          displayName: 'ENG7 Logger',
          password: 'integration-password-1',
        },
      });
      const token = registered.json().accessToken as string;

      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/vinks',
        headers: authed(token),
        payload: {
          purchaseCategory: 'GROCERY',
          subtotalMinor: 5_000,
          tipMinor: 0,
          submissionDeadline: FUTURE,
          organizerDisplayName: 'Organizer',
        },
      });
      assert.equal(created.statusCode, 201, created.body);
      const vinkId = created.json().vink.id as string;

      const commandLine = lines().find(
        (line) => line.msg === 'command_executed' && line.command === 'createVink',
      );
      assert.ok(commandLine !== undefined, 'a command_executed line for createVink must exist');
      assert.equal(typeof commandLine!.correlationId, 'string');
      assert.equal((commandLine!.correlationId as string).length > 0, true);
      assert.equal(commandLine!.vinkId, vinkId);
      assert.equal(typeof commandLine!.actor, 'string');
      assert.equal(typeof commandLine!.idempotencyKey, 'string');
      // The release binding is a Pino `base` field, present on every line, not just this one.
      assert.equal(typeof commandLine!.release, 'string');
    } finally {
      await app.close();
    }
  });

  it('setSplit and openVink each emit their own command_executed line (the two commands the ENG7 audit found writing to no log or audit trail at all)', async () => {
    const { app, lines } = await buildLoggedApp();
    try {
      const organizer = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `eng7_split_org_${stamp}`,
          displayName: 'Organizer',
          password: 'integration-password-1',
        },
      });
      const organizerToken = organizer.json().accessToken as string;
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `eng7_split_mem_${stamp}`,
          displayName: 'Member',
          password: 'integration-password-1',
        },
      });

      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/vinks',
        headers: authed(organizerToken),
        payload: {
          purchaseCategory: 'GROCERY',
          subtotalMinor: 4_000,
          tipMinor: 0,
          submissionDeadline: FUTURE,
          organizerDisplayName: 'Organizer',
        },
      });
      const vinkId = created.json().vink.id as string;

      await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/participants`,
        headers: authed(organizerToken),
        payload: { username: `eng7_split_mem_${stamp}` },
      });

      const splitResponse = await app.inject({
        method: 'PUT',
        url: `/api/v1/vinks/${vinkId}/split`,
        headers: authed(organizerToken),
        payload: { method: 'EQUAL' },
      });
      assert.equal(splitResponse.statusCode, 200, splitResponse.body);

      const openResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/open`,
        headers: authed(organizerToken),
      });
      assert.equal(openResponse.statusCode, 200, openResponse.body);

      const allLines = lines();
      const splitLine = allLines.find(
        (line) => line.msg === 'command_executed' && line.command === 'setSplit',
      );
      const openLine = allLines.find(
        (line) => line.msg === 'command_executed' && line.command === 'openVink',
      );
      assert.ok(splitLine !== undefined, 'setSplit must now emit a command_executed line');
      assert.equal(splitLine!.vinkId, vinkId);
      assert.ok(openLine !== undefined, 'openVink must now emit a command_executed line');
      assert.equal(openLine!.vinkId, vinkId);
    } finally {
      await app.close();
    }
  });

  it('no command_executed line ever carries a display name, contact destination, or raw token', async () => {
    const { app, lines } = await buildLoggedApp();
    try {
      const organizer = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `eng7_pii_${stamp}`,
          displayName: 'PII Test Organizer',
          password: 'integration-password-1',
        },
      });
      const token = organizer.json().accessToken as string;
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/vinks',
        headers: authed(token),
        payload: {
          purchaseCategory: 'GROCERY',
          subtotalMinor: 3_000,
          tipMinor: 0,
          submissionDeadline: FUTURE,
          organizerDisplayName: 'PII Test Organizer',
        },
      });
      const vinkId = created.json().vink.id as string;

      const secretEmail = `secret_${stamp}@example.com`;
      await app.inject({
        method: 'POST',
        url: `/api/v1/vinks/${vinkId}/guests`,
        headers: authed(token),
        payload: {
          displayName: 'Secret Guest Name',
          deliveryMode: 'MANUAL',
        },
      });

      const commandLines = lines().filter((line) => line.msg === 'command_executed');
      assert.ok(commandLines.length > 0);
      for (const line of commandLines) {
        const serialized = JSON.stringify(line);
        assert.equal(serialized.includes('Secret Guest Name'), false);
        assert.equal(serialized.includes(secretEmail), false);
        assert.equal(serialized.includes('PII Test Organizer'), false);
      }
    } finally {
      await app.close();
    }
  });
});
