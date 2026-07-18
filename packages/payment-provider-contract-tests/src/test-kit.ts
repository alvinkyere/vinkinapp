import type { FinancialProvider, ProviderEvent } from '../../payment-provider/src/index.ts';

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

  /** Provision a customer + payment method with the given behavior. */
  createCustomerAndMethod(behavior: 'ok' | 'decline' | 'pending'): Promise<{
    providerCustomerId: string;
    providerMethodId: string;
  }>;

  // --- payment-side simulation hooks ---
  resolvePendingAuthorization?(
    providerPaymentId: string,
    outcome: 'AUTHORIZED' | 'DECLINED',
  ): void | Promise<void>;
  expireAuthorization?(providerPaymentId: string): void | Promise<void>;
  simulateTransientFailure?(): void; // next provider call fails BEFORE executing
  simulateLostResponse?(): void; // next provider call executes, then the response is lost

  // --- webhook/event simulation hooks ---
  drainEvents?(): ProviderEvent[];
  duplicateLastEvent?(): void;
  swapLastTwoEvents?(): void;
  signWebhook?(rawBody: string, secret: string): string;

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
