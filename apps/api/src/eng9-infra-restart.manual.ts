/**
 * ENG9 ("Remote workflow certification") — scenarios #3 (Redis restart) and #4 (PostgreSQL
 * failover/connection interruption). Kept separate from `eng9-process-restart.integration
 * .test.ts`: these stop/start the REAL local brew-managed Redis/PostgreSQL services — the
 * same ones every OTHER integration test in this repo depends on.
 *
 * DELIBERATELY named `.manual.ts`, not `.test.ts`: `node --test "src/**\/*.test.ts"` (this
 * package's own `npm test`) runs test FILES concurrently by default. The first real run of
 * this suite, before the rename, broke a concurrently-running `realtime.integration.test.ts`
 * suite by yanking Redis out from under it mid-test — a genuine, real discovery, not a
 * hypothetical concern. Run in isolation only: `npm run test:eng9-infra-restart` (its own
 * package.json script, `node --test` on this exact path, nothing else in the same process).
 *
 * Also LOCAL-ONLY, not CI-wired: `brew services` doesn't exist in the GitHub Actions runner
 * (CI's Postgres/Redis are Docker service containers, a different lifecycle entirely —
 * `docker stop`/`start` would be the CI-equivalent primitive, not built here). This suite
 * proves the scenario against a real local install; it is not, and currently cannot be, part
 * of the automated PR gate. Disclosed in the ENG9 certification report, not hidden.
 *
 * Restricted to local dev for the hosted-Railway half of the same reason — see the
 * certification report for why this genuinely cannot run against the hosted deployment from
 * this environment (no Railway credentials exist here), and why the owner's own choice was
 * "certify via equivalent local tests instead."
 *
 * Each test always restores the service to a running state in its own `finally`/`after`,
 * even on failure — this suite must never leave local Postgres/Redis down for whatever runs
 * after it.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createChildProcessTestDb, type ChildProcessTestDb } from './testing/child-process-db.ts';
import { spawnApiServer, type ChildServerHandle } from './testing/child-server.ts';

const execFileAsync = promisify(execFile);
const RUN = process.env.VINKIN_INTEGRATION === '1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function brewService(action: 'stop' | 'start', service: string): Promise<void> {
  await execFileAsync('brew', ['services', action, service]);
}

interface HealthBody {
  status: string;
  checks: { database: 'ok' | 'down'; redis: 'ok' | 'down' };
}

async function pollHealth(
  port: number,
  predicate: (body: HealthBody) => boolean,
  timeoutMs = 15_000,
): Promise<HealthBody> {
  const deadline = Date.now() + timeoutMs;
  let last: HealthBody | undefined;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
      last = (await response.json()) as HealthBody;
      if (predicate(last)) return last;
    } catch {
      // connection error counts as "not yet matching" — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `health check did not match predicate within ${timeoutMs}ms; last=${JSON.stringify(last)}`,
  );
}

function baseEnv(db: ChildProcessTestDb): Record<string, string> {
  return { VINKIN_ENV: 'test', DATABASE_URL: db.databaseUrl, LOG_LEVEL: 'info' };
}

describe(
  'ENG9 infrastructure restart certification (real local Redis/PostgreSQL)',
  { skip: !RUN },
  () => {
    describe('#3 Redis restart', () => {
      let db: ChildProcessTestDb;
      let server: ChildServerHandle;

      before(async () => {
        db = await createChildProcessTestDb('eng9_redis_restart');
        server = await spawnApiServer(baseEnv(db));
        await server.waitUntilReady();
      });

      after(async () => {
        await server.kill('SIGKILL').catch(() => {});
        await db.drop();
        await brewService('start', 'redis').catch(() => {});
      });

      it('the API stays up and DB-only operations keep working through a real Redis outage, then recovers', async () => {
        const readyBefore = await pollHealth(server.port, (b) => b.status === 'ready');
        assert.equal(readyBefore.checks.redis, 'ok');

        try {
          await brewService('stop', 'redis');

          // The API process itself must survive Redis going away — it should degrade, not crash.
          const duringOutage = await pollHealth(
            server.port,
            (b) => b.checks.redis === 'down',
            10_000,
          );
          assert.equal(duringOutage.status, 'unavailable');
          assert.equal(
            duringOutage.checks.database,
            'ok',
            'PostgreSQL is unaffected by a Redis outage',
          );

          // A DB-only command path (register + create a Vink; MockFinancialProvider needs no
          // Redis) must keep working — Redis being down should not take down unrelated
          // functionality.
          const registered = await fetch(`http://127.0.0.1:${server.port}/api/v1/auth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              username: `eng9_redis_outage_${Date.now()}`,
              displayName: 'Organizer',
              password: 'integration-password-1',
            }),
          });
          assert.equal(
            registered.status,
            201,
            'registration (no Redis dependency) survives the outage',
          );
          const { accessToken } = (await registered.json()) as { accessToken: string };

          const created = await fetch(`http://127.0.0.1:${server.port}/api/v1/vinks`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              purchaseCategory: 'GROCERY',
              subtotalMinor: 5_000,
              tipMinor: 0,
              submissionDeadline: FUTURE,
              organizerDisplayName: 'Organizer',
            }),
          });
          assert.equal(
            created.status,
            201,
            'vink creation (no Redis dependency) survives the outage',
          );
        } finally {
          await brewService('start', 'redis');
        }

        const readyAfter = await pollHealth(server.port, (b) => b.status === 'ready', 15_000);
        assert.equal(
          readyAfter.checks.redis,
          'ok',
          'health reports fully recovered once Redis returns',
        );
      });
    });

    describe('#4 PostgreSQL restart / connection interruption', () => {
      let db: ChildProcessTestDb;
      let server: ChildServerHandle;

      before(async () => {
        db = await createChildProcessTestDb('eng9_pg_restart');
        server = await spawnApiServer(baseEnv(db));
        await server.waitUntilReady();
      });

      after(async () => {
        await server.kill('SIGKILL').catch(() => {});
        await brewService('start', 'postgresql@16').catch(() => {});
        // Postgres must be back up before this suite's own cleanup can drop its test database.
        await db.drop().catch(() => {});
      });

      it('the API reports unavailable (never hangs) during a real PostgreSQL outage, then recovers cleanly', async () => {
        const readyBefore = await pollHealth(server.port, (b) => b.status === 'ready');
        assert.equal(readyBefore.checks.database, 'ok');

        try {
          await brewService('stop', 'postgresql@16');

          const duringOutage = await pollHealth(
            server.port,
            (b) => b.checks.database === 'down',
            10_000,
          );
          assert.equal(duringOutage.status, 'unavailable');

          // A DB-dependent request must fail CLEANLY (bounded time, a real error status) —
          // never hang indefinitely waiting on a dead connection pool.
          const attemptDuringOutage = await Promise.race([
            fetch(`http://127.0.0.1:${server.port}/api/v1/auth/register`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                username: `eng9_pg_outage_${Date.now()}`,
                displayName: 'Organizer',
                password: 'integration-password-1',
              }),
            }).then((r) => ({ kind: 'response' as const, status: r.status })),
            new Promise<{ kind: 'timeout' }>((resolve) =>
              setTimeout(() => resolve({ kind: 'timeout' }), 8_000),
            ),
          ]);
          assert.notEqual(
            attemptDuringOutage.kind,
            'timeout',
            'a request during a real PostgreSQL outage must fail within a bounded time, not hang',
          );
          if (attemptDuringOutage.kind === 'response') {
            assert.ok(
              attemptDuringOutage.status >= 500,
              `expected a server-error status during the outage, got ${attemptDuringOutage.status}`,
            );
          }
        } finally {
          await brewService('start', 'postgresql@16');
        }

        const readyAfter = await pollHealth(server.port, (b) => b.status === 'ready', 20_000);
        assert.equal(readyAfter.checks.database, 'ok');

        // A real request succeeds again post-recovery — proves the connection pool actually
        // heals, not just that the shallow health-check ping happens to succeed once.
        const afterRecovery = await fetch(`http://127.0.0.1:${server.port}/api/v1/auth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            username: `eng9_pg_recovered_${Date.now()}`,
            displayName: 'Organizer',
            password: 'integration-password-1',
          }),
        });
        assert.equal(afterRecovery.status, 201);
      });
    });
  },
);
