/**
 * ENG7 ("Observability and auditability") — a single, consistent "a command ran" log line
 * for every application command, carrying exactly the fields the roadmap names: correlation
 * id, actor (a user id or a `guest:<id>` string, matching `applyContributionTransition`'s own
 * existing actor convention), Vink id, the command's own name, and an idempotency key when
 * the command has one. Deliberately minimal: only ids/amounts/booleans ever go into `data` —
 * no contact info, no provider tokens, no raw payloads. This is operational visibility
 * (Logging), distinct from the durable audit trail (`vink_state_history`/
 * `contribution_status_history`/`operator_audit_log`), which already exists separately.
 */

import type { CommandLogger } from '../ports.ts';

export function logCommand(
  logger: CommandLogger | undefined,
  command: string,
  data: {
    correlationId: string;
    actor: string;
    vinkId?: string | undefined;
    idempotencyKey?: string | undefined;
  } & Record<string, unknown>,
): void {
  logger?.info('command_executed', { command, ...data });
}
