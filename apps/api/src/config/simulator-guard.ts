/**
 * Simulator-endpoint environment guard (governance §5): registration is permitted only for
 * environments on this ALLOWLIST — never a `!== 'production'` check. No simulator routes
 * exist yet (they arrive with PV5/PV6); every one of them must pass through this guard.
 */

import type { VinkinEnvironment } from './env.ts';

export const SIMULATOR_ALLOWED_ENVS: readonly VinkinEnvironment[] = ['development', 'test', 'demo'];

export function simulatorRoutesPermitted(env: VinkinEnvironment): boolean {
  return SIMULATOR_ALLOWED_ENVS.includes(env);
}
