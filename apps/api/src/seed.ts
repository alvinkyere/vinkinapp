/**
 * Local seed (PV1): three demo users for manual API exploration. Idempotent. Refuses to run
 * outside development/test/demo (same allowlist rule as simulator endpoints, governance §5).
 *
 * Run: pnpm --filter @vinkin/api seed
 */

import { loadEnv } from './config/env.ts';
import { createDb } from './db/client.ts';
import { hashPassword } from './auth/passwords.ts';
import { simulatorRoutesPermitted } from './config/simulator-guard.ts';

const env = loadEnv();
if (!simulatorRoutesPermitted(env.VINKIN_ENV)) {
  console.error(`seed refused: VINKIN_ENV=${env.VINKIN_ENV} is not a seedable environment`);
  process.exit(1);
}

const sql = createDb(env);
const DEMO_PASSWORD = 'vinkin-demo-password';

const demoUsers = [
  { username: 'demo_organizer', displayName: 'Demo Organizer', email: 'organizer@vinkin.test' },
  { username: 'demo_member_1', displayName: 'Demo Member One', email: 'member1@vinkin.test' },
  { username: 'demo_member_2', displayName: 'Demo Member Two', email: 'member2@vinkin.test' },
];

try {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const user of demoUsers) {
    await sql`
      INSERT INTO users (username, display_name, email, password_hash)
      VALUES (${user.username}, ${user.displayName}, ${user.email}, ${passwordHash})
      ON CONFLICT (username) DO NOTHING`;
  }
  console.log(`seeded ${demoUsers.length} demo users (password: ${DEMO_PASSWORD})`);
} finally {
  await sql.end();
}
