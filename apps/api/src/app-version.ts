/**
 * ENG3 ("app-version enforcement"): the audit found no mechanism anywhere for the server to
 * signal a minimum supported client version. `VINKIN_MINIMUM_APP_VERSION` (config/env.ts) is
 * unset by default — no enforcement — matching every other static flag in this codebase's own
 * "off preserves exact current behavior" convention. When set, `app.ts`'s `onRequest` hook
 * compares it against the client-sent `x-app-version` header (only `apps/mobile` ever sends
 * one; `apps/guest-web`/`apps/operations-console` are unaffected by construction, not by a
 * carve-out this file has to remember).
 */

export type AppVersion = readonly [major: number, minor: number, patch: number];

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** `null` for anything not shaped like a plain `major.minor.patch` string — deliberately
 * strict (no `v` prefix, no build-number suffix; the client sends its package version, e.g.
 * `1.0.0`, never the `+1` build number alongside it — a store release's build number can
 * change without the app itself needing a forced update). */
export function parseAppVersion(version: string): AppVersion | null {
  const match = VERSION_PATTERN.exec(version.trim());
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** `true` whenever either version fails to parse — fail-open, never fail-closed. A malformed
 * header must never be able to lock every client out of the API; that failure mode is far
 * worse than the enforcement this function exists to provide in the first place. */
export function isAppVersionSupported(clientVersion: string, minimumVersion: string): boolean {
  const client = parseAppVersion(clientVersion);
  const minimum = parseAppVersion(minimumVersion);
  if (client === null || minimum === null) return true;
  const [clientMajor, clientMinor, clientPatch] = client;
  const [minMajor, minMinor, minPatch] = minimum;
  if (clientMajor !== minMajor) return clientMajor > minMajor;
  if (clientMinor !== minMinor) return clientMinor > minMinor;
  if (clientPatch !== minPatch) return clientPatch > minPatch;
  return true; // exactly equal
}
