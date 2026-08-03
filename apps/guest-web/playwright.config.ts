import { defineConfig, devices } from '@playwright/test';

/**
 * PV10 exit-gate harness. Requires the real backend already running (Postgres + Redis +
 * apps/api/src/server.ts — same expectation as apps/api's own VINKIN_INTEGRATION=1 tests
 * and apps/mobile's integration_test suite) at API_BASE_URL / NEXT_PUBLIC_API_BASE_URL.
 * `webServer` builds and boots guest-web itself in production mode — dev mode's Turbopack
 * HMR websocket fails to handshake in this environment and silently prevents hydration
 * (verified directly: effects never fire, confirmed via a minimal isolated repro), so
 * tests run against a real production build, not `next dev`.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    // iPhone 13 viewport/UA on Chromium (already installed) rather than WebKit (its own
    // ~300MB browser download) — this is a mobile-viewport rendering/interaction proof, not
    // a WebKit-engine compatibility proof.
    ...devices['iPhone 13'],
    browserName: 'chromium',
  },
  webServer: {
    command: 'npm run build && npm run start -- -p 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
