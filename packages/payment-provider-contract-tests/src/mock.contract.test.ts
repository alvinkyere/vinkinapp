import { MockFinancialProvider } from '../../payment-provider/src/index.ts';
import { runFinancialProviderContractTests } from './contract-suite.ts';
import type { ProviderTestKit } from './test-kit.ts';

/**
 * The mock adapter runs the full conformance suite with every hook wired — zero skips.
 * When StripeFinancialProvider (or any other adapter) lands, it gets its own
 * `<name>.contract.test.ts` calling the same suite with a sandbox-backed kit; any hook the
 * sandbox cannot provide becomes a documented skip in that adapter's README.
 */
function makeMockKit(): ProviderTestKit {
  const provider = new MockFinancialProvider();
  let fixtureCounter = 0;

  return {
    provider,

    async createCustomerAndMethod(behavior) {
      fixtureCounter += 1;
      const tokenForBehavior: Record<string, string> = {
        decline: 'tok_decline',
        pending: 'tok_pending',
        insufficient_funds: 'tok_insufficient_funds',
        compliance_blocked: 'tok_compliance_blocked',
        expired_method: 'tok_expired_method',
      };
      const token = tokenForBehavior[behavior] ?? 'tok_ok';
      const { providerCustomerId } = await provider.createCustomer({
        idempotencyKey: `cus:kit:${fixtureCounter}`,
        externalUserId: `user-${fixtureCounter}`,
      });
      const { providerMethodId } = await provider.setupPaymentMethod({
        idempotencyKey: `pm:kit:${fixtureCounter}`,
        providerCustomerId,
        methodToken: token,
        usage: 'CONTRIBUTION',
      });
      return { providerCustomerId, providerMethodId };
    },

    resolvePendingAuthorization: (paymentId, outcome) =>
      provider.resolvePendingAuthorization(paymentId, outcome),
    confirmContributionPaymentIntent: (paymentId, behavior) =>
      provider.resolvePendingAuthorization(
        paymentId,
        behavior === 'ok' ? 'AUTHORIZED' : 'DECLINED',
      ),
    expireAuthorization: (paymentId) => provider.expireAuthorization(paymentId),
    simulateTransientFailure: () => provider.simulateTransientFailure(),
    simulateLostResponse: () => provider.simulateLostResponse(),
    simulateUnknownOutcome: (sideEffectHappened) =>
      provider.simulateUnknownOutcome(sideEffectHappened),

    drainEvents: () => provider.drainEvents(),
    duplicateLastEvent: () => provider.duplicateLastEvent(),
    swapLastTwoEvents: () => provider.swapLastTwoEvents(),
    signWebhook: (rawBody, secret) => MockFinancialProvider.sign(rawBody, secret),

    async issueCard(spendLimitMinor) {
      fixtureCounter += 1;
      const { providerCardholderId } = await provider.createCardholder({
        idempotencyKey: `ch:kit:${fixtureCounter}`,
        externalAccountId: `account-${fixtureCounter}`,
        legalName: 'Contract Kit Organizer',
      });
      const { providerCardId } = await provider.issueTemporaryCard({
        idempotencyKey: `issue-card:kit:${fixtureCounter}`,
        providerCardholderId,
        spendLimit: { amountMinor: spendLimitMinor, currency: 'USD' },
        metadata: { vinkId: `vink-${fixtureCounter}` },
      });
      return providerCardId;
    },

    async merchantAuthorize(providerCardId, amountMinor, mcc) {
      const outcome = provider.simulateMerchantAuthorization({
        providerCardId,
        amount: { amountMinor, currency: 'USD' },
        merchantId: 'mch_contract',
        merchantName: 'Contract Test Merchant',
        mcc,
        merchantCountry: 'US',
      });
      const result: { approved: boolean; declineReason?: string } = { approved: outcome.approved };
      if (outcome.declineReason !== undefined) result.declineReason = outcome.declineReason;
      return result;
    },

    async setBlockedMccs(providerCardId, mccs) {
      await provider.updateCardControls({ providerCardId, blockedMccs: mccs });
    },
  };
}

runFinancialProviderContractTests('MockFinancialProvider', makeMockKit);
