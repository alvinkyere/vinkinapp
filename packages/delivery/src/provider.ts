import type { DeliveryInput, DeliveryResult } from './types.ts';

/**
 * The provider-neutral invitation-delivery interface (Slice I4, D19/D27) — mirrors
 * `packages/payment-provider`'s `FinancialProvider` abstraction pattern: application code
 * only ever depends on this interface, a real SMS/email SDK is importable only inside an
 * approved adapter directory (once a provider is actually selected — external dependency,
 * §4), and the mock adapter is what every test in this codebase runs against today.
 *
 * Contract every adapter must satisfy:
 *  1. `send` never throws for an ordinary provider-side rejection (invalid address, bounced
 *     number) — it resolves `{accepted: false, failureReason}`. A thrown error means the
 *     adapter itself is broken (network failure, auth failure), not that the message bounced.
 *  2. A failed `send` never blocks or misrepresents the caller's own already-committed state
 *     (Phase 5 §2's locked rule) — the caller records the failure and moves on.
 */
export interface DeliveryProvider {
  readonly providerName: string;

  send(input: DeliveryInput): Promise<DeliveryResult>;
}
