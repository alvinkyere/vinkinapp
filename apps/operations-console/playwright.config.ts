import { defineConfig } from '@playwright/test';

/**
 * PV11 exit-gate harness. Requires the real backend already running (Postgres + Redis +
 * apps/api/src/server.ts) at API_BASE_URL — same expectation as apps/guest-web's own
 * Playwright config. `webServer` builds and boots the console itself in production mode
 * (Turbopack dev mode's HMR websocket fails to handshake in this environment and silently
 * blocks hydration — the same PV10-discovered issue, unrelated to this app's own code).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3200',
  },
  webServer: {
    command: 'npm run build && npm run start -- -p 3200',
    url: 'http://127.0.0.1:3200',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
