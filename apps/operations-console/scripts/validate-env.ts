/**
 * ENG4 Slice 1: run before `next start` (see package.json's `start` script) so a
 * misconfigured staging/production deployment refuses to start rather than serving traffic
 * against, e.g., a loopback API URL nobody outside the host machine can reach — worse here
 * than on guest-web, since this console also carries D17's shared operator credential.
 */

import { loadEnv } from '../lib/env.ts';

try {
  const env = loadEnv();
  console.log(`[validate-env] ok — VINKIN_ENV=${env.VINKIN_ENV}`);
} catch (error) {
  console.error(`[validate-env] refusing to start: ${(error as Error).message}`);
  process.exit(1);
}
