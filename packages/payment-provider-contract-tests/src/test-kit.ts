import type {
  FinancialProvider,
  ProviderEvent,
  ProviderEventType,
} from '../../payment-provider/src/index.ts';

/**
 * What an adapter must hand the conformance suite. `provider` and
 * `createCustomerAndMethod` are mandatory; every simulation hook is optional because real
 * sandboxes differ in what they can force. A missing hook SKIPS the dependent tests with an
 * explicit reason — a skip is a visible coverage gap for that adapter, never a pass.
 *
 * The suite calls `makeKit()` fresh for every test: kits must return an isolated provider
 * (mock: new instance; sandbox: unique fixtures) so tests cannot couple through state.
 */
export interface ProviderTestKit {
  provider: FinancialProvider;

  /** Provision a customer + payment method with the given behavior. ENG6 Slice 2 added the
   * three named-decline-reason behaviors — a kit that can only force a generic decline
   * (not distinguish which `ContributionDeclineReason`) is a real, visible coverage gap for
   * that adapter, not silently treated as equivalent to `'decline'`. */
  createCustomerAndMethod(
    behavior:
      'ok' | 'decline' | 'pending' | 'insufficient_funds' | 'compliance_blocked' | 'expired_method',
  ): Promise<{
    providerCustomerId: string;
    providerMethodId: string;
  }>;

  // --- payment-side simulation hooks ---
  resolvePendingAuthorization?(
    providerPaymentId: string,
    outcome: 'AUTHORIZED' | 'DECLINED',
  ): void | Promise<void>;
  /** RM4C — confirms a `createContributionPaymentIntent` result exactly the way the real
   * client (Stripe Elements / PaymentSheet, or the mock's own equivalent) would, without a
   * browser: 'ok' confirms with a valid test card, 'decline' with Stripe's own documented
   * always-declines test card. Distinct from `resolvePendingAuthorization` (which resolves
   * the OLD token-based `tok_pending` flow) since a client-secret-based intent has no
   * pre-attached method to simply flip a status on. */
  confirmContributionPaymentIntent?(
    providerPaymentId: string,
    behavior: 'ok' | 'decline',
  ): void | Promise<void>;
  expireAuthorization?(providerPaymentId: string): void | Promise<void>;
  simulateTransientFailure?(): void; // next provider call fails BEFORE executing
  simulateLostResponse?(): void; // next provider call executes, then the response is lost
  /** ENG6 Slice 2 — next provider call throws UNKNOWN_OUTCOME; `sideEffectHappened` is the
   * ground truth a test confirms afterward via `retrievePaymentStatus`. */
  simulateUnknownOutcome?(sideEffectHappened: boolean): void;

  // --- webhook/event simulation hooks ---
  drainEvents?(): ProviderEvent[];
  duplicateLastEvent?(): void;
  swapLastTwoEvents?(): void;
  signWebhook?(rawBody: string, secret: string): string;
  /** ENG6 Slice 3 — builds a raw webhook body `parseWebhookEvent` can actually translate for
   * THIS adapter. A mock that generates events already shaped like VinkIn's own
   * `ProviderEvent` needs no translation and can echo `providerEventId`/`type`/`objectId`
   * straight through; a real adapter parses the PROVIDER's own wire format, so a body
   * shaped like VinkIn's internal vocabulary would never structurally match what its real
   * `parseWebhookEvent` expects. Optional: a kit that omits it gets the suite's own
   * mock-shaped default, preserving exact prior behavior for every kit that never needed
   * this distinction. */
  buildTestEventRawBody?(input: {
    providerEventId: string;
    type: ProviderEventType;
    objectId: string;
  }): string;

  // --- issuing-side simulation hooks ---
  issueCard?(spendLimitMinor: number): Promise<string>; // returns providerCardId
  merchantAuthorize?(
    providerCardId: string,
    amountMinor: number,
    mcc: string,
  ): Promise<{ approved: boolean; declineReason?: string }>;
  setBlockedMccs?(providerCardId: string, mccs: readonly string[]): Promise<void>;
}

export type MakeKit = () => ProviderTestKit | Promise<ProviderTestKit>;
