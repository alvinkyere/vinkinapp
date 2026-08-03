/**
 * ENG7: adapts the real Prometheus-backed `Metrics` (observability/metrics.ts) to
 * `packages/application`'s dependency-free `CommandMetrics` port — same pattern as
 * `command-logger.ts`'s `toCommandLogger`.
 */

import type { CommandMetrics } from '../../../../packages/application/src/index.ts';
import type { Metrics } from './metrics.ts';

export function toCommandMetrics(metrics: Metrics): CommandMetrics {
  return {
    recordReplay: (command) => metrics.recordCommandReplay({ command }),
    recordContributionOutcome: (outcome) => metrics.recordContributionOutcome({ outcome }),
    recordAuthorizationOutcome: (outcome) => metrics.recordAuthorizationOutcome({ outcome }),
    recordRefundOutcome: (outcome) => metrics.recordRefundOutcome({ outcome }),
  };
}
