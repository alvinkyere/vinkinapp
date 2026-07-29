/**
 * ENG9 — spawns `apps/api` entrypoints (`server.ts`, `jobs/worker.ts`) as REAL, separate OS
 * processes, for tests that need to prove behavior across an actual process kill/restart —
 * something no `buildApp()`/`app.inject()`-based integration test (the rest of this repo's
 * suite) can prove, since those all run in-process. `net.createServer().listen(0)` picks a
 * genuinely free port so parallel test runs never collide.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createServer } from 'node:net';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('could not determine a free port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

export interface ChildServerHandle {
  port: number;
  process: ChildProcessByStdio<null, Readable, Readable>;
  logs: string[];
  /**
   * Waits until ready, or throws after `timeoutMs`. `server.ts` has a real `/health/ready`
   * endpoint to poll; `jobs/worker.ts` has no HTTP surface at all, so its readiness is
   * detected from its own real startup log line (`"worker started"`) instead.
   */
  waitUntilReady(timeoutMs?: number): Promise<void>;
  /** Sends a signal (default SIGTERM) and resolves once the process has genuinely exited. */
  kill(signal?: NodeJS.Signals): Promise<void>;
}

export function spawnApiServer(env: Record<string, string>): Promise<ChildServerHandle> {
  return spawnEntrypoint('src/server.ts', env, { kind: 'http' });
}

export function spawnWorker(env: Record<string, string>): Promise<ChildServerHandle> {
  return spawnEntrypoint('src/jobs/worker.ts', env, {
    kind: 'log',
    pattern: 'worker started',
  });
}

type ReadinessStrategy = { kind: 'http' } | { kind: 'log'; pattern: string };

async function spawnEntrypoint(
  entrypoint: string,
  env: Record<string, string>,
  readiness: ReadinessStrategy,
): Promise<ChildServerHandle> {
  const port = Number(env.PORT ?? (await freePort()));
  const child = spawn('node', [entrypoint], {
    cwd: API_ROOT,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => logs.push(chunk.toString()));

  let exited = false;
  child.once('exit', () => {
    exited = true;
  });

  return {
    port,
    process: child,
    logs,
    async waitUntilReady(timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (exited) {
          throw new Error(
            `child process for ${entrypoint} exited before becoming ready:\n${logs.join('')}`,
          );
        }
        if (readiness.kind === 'log') {
          if (logs.some((line) => line.includes(readiness.pattern))) return;
        } else {
          try {
            const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
            if (response.ok) return;
          } catch {
            // connection refused — not listening yet, keep polling
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error(
        `child process for ${entrypoint} did not become ready within ${timeoutMs}ms:\n${logs.join('')}`,
      );
    },
    async kill(signal: NodeJS.Signals = 'SIGTERM') {
      if (exited) return;
      child.kill(signal);
      await new Promise<void>((resolve) => {
        if (exited) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
      });
    },
  };
}
