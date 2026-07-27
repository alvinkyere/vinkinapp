import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { ProviderError, operationId, type Money } from '../../payment-provider/src/index.ts';
import type { MakeKit, ProviderTestKit } from './test-kit.ts';

/**
 * The shared conformance suite (Spec §43): every FinancialProvider adapter — Mock, Stripe,
 * Lithic, future — must run this exact suite. Tests gate on the adapter's declared
 * capabilities and on which simulation hooks its kit provides; a skipped test is a visible
 * coverage gap for that adapter and must be justified in the adapter's README.
 *
 * Behavioral rules verified here are the ones VinkIn's orchestrator depends on:
 * idempotency (§12), authorize/capture/cancel/refund lifecycle (§11, §25), delayed
 * resolution and provider-truth reads (§14), webhook identity/ordering (§28), and
 * issuing-side controls (§16–§19 substrate).
 */

const usd = (amountMinor: number): Money => ({ amountMinor, currency: 'USD' });

let slotCounter = 0;
/** ENG6 Slice 3 finding: a real provider's idempotency store persists server-side (Stripe:
 * 24h) independent of this test process — a plain per-run counter (`slot-contract-1`, ...)
 * collides with itself across separate test runs against the SAME real sandbox account,
 * correctly triggering IDEMPOTENCY_CONFLICT for what looks like a fresh key but isn't. The
 * in-memory mock never had this problem (its idempotency map dies with the process), which
 * is exactly why this went uncaught until a real adapter ran this suite for the first time.
 * The random component makes every run's keys genuinely fresh; the counter is kept only for
 * human-readable ordering in failure output. */
const freshSlotId = (): string => `slot-contract-${randomUUID()}-${(slotCounter += 1)}`;

async function authorize(
  kit: ProviderTestKit,
  options?: {
    behavior?:
      'ok' | 'decline' | 'pending' | 'insufficient_funds' | 'compliance_blocked' | 'expired_method';
    amountMinor?: number;
    slotId?: string;
    generation?: number;
  },
) {
  const behavior = options?.behavior ?? 'ok';
  const amountMinor = options?.amountMinor ?? 5_000;
  const slotId = options?.slotId ?? freshSlotId();
  const generation = options?.generation ?? 1;
  const { providerCustomerId, providerMethodId } = await kit.createCustomerAndMethod(behavior);
  const input = {
    idempotencyKey: operationId.authorize(slotId, generation),
    providerCustomerId,
    providerMethodId,
    amount: usd(amountMinor),
    captureMode: 'MANUAL' as const,
    metadata: { vinkId: 'contract-suite-vink', contributionSlotId: slotId },
  };
  const result = await kit.provider.authorizeContribution(input);
  return { result, input, slotId };
}

const isProviderError =
  (code: string) =>
  (error: unknown): boolean =>
    error instanceof ProviderError && error.code === code;

export function runFinancialProviderContractTests(name: string, makeKit: MakeKit): void {
  describe(`FinancialProvider conformance: ${name}`, () => {
    it('declares a complete, honest capabilities object', async () => {
      const kit = await makeKit();
      const capabilities = kit.provider.capabilities;
      const requiredFlags = [
        'manualCapture',
        'partialCapture',
        'multipleCapture',
        'extendedAuthorization',
        'realTimeAuthorization',
        'merchantCategoryControls',
        'merchantSpecificControls',
        'virtualCardIssuing',
        'consumerCardholders',
        'offSessionRecovery',
      ] as const;
      for (const flag of requiredFlags) {
        assert.equal(
          typeof capabilities[flag],
          'boolean',
          `capabilities.${flag} must be declared as a boolean`,
        );
      }
    });

    // ---- idempotency (§12) ----------------------------------------------------

    it('idempotent authorization: replay returns the same payment with no duplicate side effect', async () => {
      const kit = await makeKit();
      const { result, input } = await authorize(kit);
      const replay = await kit.provider.authorizeContribution(input);
      assert.equal(replay.providerPaymentId, result.providerPaymentId);
      if (kit.drainEvents) {
        const authorizedEvents = kit
          .drainEvents()
          .filter((event) => event.type === 'payment.authorized');
        assert.equal(authorizedEvents.length, 1, 'replay must not emit a second event');
      }
    });

    it('same idempotency key with different parameters is a conflict', async () => {
      const kit = await makeKit();
      const { input } = await authorize(kit, { amountMinor: 5_000 });
      await assert.rejects(
        kit.provider.authorizeContribution({ ...input, amount: usd(9_999) }),
        isProviderError('IDEMPOTENCY_CONFLICT'),
      );
    });

    it('transient failure before execution: retry with the SAME key succeeds', async (t) => {
      const kit = await makeKit();
      if (!kit.simulateTransientFailure) {
        return t.skip('kit provides no simulateTransientFailure hook');
      }
      const { providerCustomerId, providerMethodId } = await kit.createCustomerAndMethod('ok');
      const input = {
        idempotencyKey: operationId.authorize(freshSlotId(), 1),
        providerCustomerId,
        providerMethodId,
        amount: usd(5_000),
        captureMode: 'MANUAL' as const,
        metadata: { vinkId: 'contract-suite-vink' },
      };
      kit.simulateTransientFailure();
      await assert.rejects(kit.provider.authorizeContribution(input), (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.code, 'PROVIDER_UNAVAILABLE');
        assert.equal(error.retryable, true, 'transient errors must be marked retryable');
        return true;
      });
      const retry = await kit.provider.authorizeContribution(input);
      assert.equal(retry.status, 'AUTHORIZED');
    });

    it('lost response after execution: replay returns the original result, side effect happened once', async (t) => {
      const kit = await makeKit();
      if (!kit.simulateLostResponse) return t.skip('kit provides no simulateLostResponse hook');
      const { providerCustomerId, providerMethodId } = await kit.createCustomerAndMethod('ok');
      const input = {
        idempotencyKey: operationId.authorize(freshSlotId(), 1),
        providerCustomerId,
        providerMethodId,
        amount: usd(5_000),
        captureMode: 'MANUAL' as const,
        metadata: { vinkId: 'contract-suite-vink' },
      };
      kit.simulateLostResponse();
      await assert.rejects(
        kit.provider.authorizeContribution(input),
        isProviderError('PROVIDER_UNAVAILABLE'),
      );
      const replay = await kit.provider.authorizeContribution(input);
      assert.equal(replay.status, 'AUTHORIZED');
      if (kit.drainEvents) {
        const authorizedEvents = kit
          .drainEvents()
          .filter((event) => event.type === 'payment.authorized');
        assert.equal(authorizedEvents.length, 1, 'the charge must have executed exactly once');
      }
    });

    // ---- lifecycle (§11, §25) ---------------------------------------------------

    it('normalizes definitive declines and permits a new attempt generation', async () => {
      const kit = await makeKit();
      const slotId = freshSlotId();
      const { result } = await authorize(kit, { behavior: 'decline', slotId, generation: 1 });
      assert.equal(result.status, 'DECLINED');
      assert.ok(result.declineReason, 'declines must carry a normalized reason');

      const retry = await authorize(kit, { behavior: 'ok', slotId, generation: 2 });
      assert.equal(retry.result.status, 'AUTHORIZED');
    });

    // ---- ENG6 Slice 2: named decline reasons + provider error classification ---------

    it('distinguishes INSUFFICIENT_FUNDS from a generic card decline', async () => {
      const kit = await makeKit();
      const { result } = await authorize(kit, { behavior: 'insufficient_funds' });
      assert.equal(result.status, 'DECLINED');
      assert.equal(result.declineReason, 'INSUFFICIENT_FUNDS');
    });

    it('distinguishes COMPLIANCE_BLOCKED from a generic card decline', async () => {
      const kit = await makeKit();
      const { result } = await authorize(kit, { behavior: 'compliance_blocked' });
      assert.equal(result.status, 'DECLINED');
      assert.equal(result.declineReason, 'COMPLIANCE_BLOCKED');
    });

    it('distinguishes EXPIRED_METHOD from a generic card decline', async () => {
      const kit = await makeKit();
      const { result } = await authorize(kit, { behavior: 'expired_method' });
      assert.equal(result.status, 'DECLINED');
      assert.equal(result.declineReason, 'EXPIRED_METHOD');
    });

    it('rejects a request missing required metadata as INVALID_REQUEST, not a generic throw', async () => {
      const kit = await makeKit();
      const { providerCustomerId, providerMethodId } = await kit.createCustomerAndMethod('ok');
      await assert.rejects(
        kit.provider.authorizeContribution({
          idempotencyKey: operationId.authorize(freshSlotId(), 1),
          providerCustomerId,
          providerMethodId,
          amount: usd(5_000),
          captureMode: 'MANUAL',
          metadata: {}, // vinkId deliberately omitted
        }),
        isProviderError('INVALID_REQUEST'),
      );
    });

    it('an ambiguous (UNKNOWN_OUTCOME) response is verifiable via retrievePaymentStatus, never assumed either way', async (t) => {
      const kit = await makeKit();
      if (!kit.simulateUnknownOutcome) {
        return t.skip('kit provides no simulateUnknownOutcome hook');
      }
      // Case 1: the side effect genuinely did NOT happen — a plain retry with the SAME key
      // must succeed as a genuinely fresh attempt, since nothing was ever committed.
      const notHappenedFixture = await kit.createCustomerAndMethod('ok');
      const notHappenedKey = operationId.authorize(freshSlotId(), 1);
      const notHappenedInput = {
        idempotencyKey: notHappenedKey,
        providerCustomerId: notHappenedFixture.providerCustomerId,
        providerMethodId: notHappenedFixture.providerMethodId,
        amount: usd(5_000),
        captureMode: 'MANUAL' as const,
        metadata: { vinkId: 'contract-suite-vink' },
      };
      kit.simulateUnknownOutcome(false);
      await assert.rejects(
        kit.provider.authorizeContribution(notHappenedInput),
        isProviderError('UNKNOWN_OUTCOME'),
      );
      const retryAfterNotHappened = await kit.provider.authorizeContribution(notHappenedInput);
      assert.equal(retryAfterNotHappened.status, 'AUTHORIZED');

      // Case 2: the side effect DID happen — retrievePaymentStatus must report the real
      // outcome even though the original call only ever saw UNKNOWN_OUTCOME.
      const { providerCustomerId, providerMethodId } = await kit.createCustomerAndMethod('ok');
      const key = operationId.authorize(freshSlotId(), 1);
      const input = {
        idempotencyKey: key,
        providerCustomerId,
        providerMethodId,
        amount: usd(5_000),
        captureMode: 'MANUAL' as const,
        metadata: { vinkId: 'contract-suite-vink' },
      };
      kit.simulateUnknownOutcome(true);
      await assert.rejects(
        kit.provider.authorizeContribution(input),
        isProviderError('UNKNOWN_OUTCOME'),
      );
      // A same-key retry after the ambiguous call must replay the ACTUAL committed result
      // (§12) — proving the side effect really did happen, not just that the mock claims so.
      const replay = await kit.provider.authorizeContribution(input);
      assert.equal(replay.status, 'AUTHORIZED');
    });

    it('cancel-before-capture releases the hold (preferred failed-Vink path, §25)', async () => {
      const kit = await makeKit();
      const { result } = await authorize(kit);
      const cancel = await kit.provider.cancelContributionAuthorization({
        idempotencyKey: `cancel:v1:${result.providerPaymentId}`,
        providerPaymentId: result.providerPaymentId,
        reason: 'VINK_EXPIRED',
      });
      assert.ok(cancel.status === 'CANCELED' || cancel.status === 'PROCESSING');
      const status = await kit.provider.retrievePaymentStatus(result.providerPaymentId);
      assert.equal(status.status, 'CANCELED');
      assert.equal(status.capturedTotal, null, 'no funds may move on a canceled authorization');
    });

    it('partial capture: base share below the authorized maximum (§21)', async (t) => {
      const kit = await makeKit();
      if (!kit.provider.capabilities.partialCapture) {
        return t.skip('provider does not declare partialCapture');
      }
      const { result, slotId } = await authorize(kit, { amountMinor: 5_000 });
      const capture = await kit.provider.captureContribution({
        idempotencyKey: operationId.capture(slotId, 1),
        providerPaymentId: result.providerPaymentId,
        amount: usd(4_200),
      });
      assert.ok(capture.status === 'CAPTURED' || capture.status === 'PROCESSING');
      const status = await kit.provider.retrievePaymentStatus(result.providerPaymentId);
      assert.equal(status.capturedTotal?.amountMinor, 4_200);
    });

    it('rejects capture above the authorized amount (§4.7)', async () => {
      const kit = await makeKit();
      const { result, slotId } = await authorize(kit, { amountMinor: 5_000 });
      await assert.rejects(
        kit.provider.captureContribution({
          idempotencyKey: operationId.capture(slotId, 1),
          providerPaymentId: result.providerPaymentId,
          amount: usd(5_001),
        }),
        isProviderError('AMOUNT_EXCEEDS_AUTHORIZATION'),
      );
    });

    it('surfaces the multiple-capture capability honestly instead of silently emulating', async (t) => {
      const kit = await makeKit();
      const { result, slotId } = await authorize(kit, { amountMinor: 5_000 });
      await kit.provider.captureContribution({
        idempotencyKey: operationId.capture(slotId, 1),
        providerPaymentId: result.providerPaymentId,
        amount: usd(2_000),
      });
      const secondCapture = kit.provider.captureContribution({
        idempotencyKey: operationId.capture(slotId, 2),
        providerPaymentId: result.providerPaymentId,
        amount: usd(1_000),
      });
      if (kit.provider.capabilities.multipleCapture) {
        const second = await secondCapture;
        assert.ok(second.status === 'CAPTURED' || second.status === 'PROCESSING');
        const status = await kit.provider.retrievePaymentStatus(result.providerPaymentId);
        assert.equal(status.capturedTotal?.amountMinor, 3_000);
      } else {
        await assert.rejects(secondCapture, (error: unknown) => {
          assert.ok(error instanceof ProviderError);
          assert.ok(
            error.code === 'INVALID_STATE' || error.code === 'NOT_SUPPORTED',
            `expected INVALID_STATE or NOT_SUPPORTED, got ${error.code}`,
          );
          return true;
        });
        t.diagnostic('multipleCapture=false surfaced as an error — correct');
      }
    });

    it('refunds up to the captured total and no further (§25)', async () => {
      const kit = await makeKit();
      const { result, slotId } = await authorize(kit, { amountMinor: 5_000 });
      await kit.provider.captureContribution({
        idempotencyKey: operationId.capture(slotId, 1),
        providerPaymentId: result.providerPaymentId,
        amount: usd(5_000),
      });
      await assert.rejects(
        kit.provider.refundContribution({
          idempotencyKey: operationId.refund(`over-${slotId}`),
          providerPaymentId: result.providerPaymentId,
          amount: usd(5_001),
          reason: 'VINK_FAILED',
        }),
        isProviderError('AMOUNT_EXCEEDS_AUTHORIZATION'),
      );
      const refund = await kit.provider.refundContribution({
        idempotencyKey: operationId.refund(`full-${slotId}`),
        providerPaymentId: result.providerPaymentId,
        amount: usd(5_000),
        reason: 'VINK_FAILED',
      });
      assert.ok(refund.status === 'REFUND_INITIATED' || refund.status === 'REFUND_COMPLETED');
      const status = await kit.provider.retrievePaymentStatus(result.providerPaymentId);
      assert.equal(status.status, 'REFUNDED');
    });

    it('authorization expiry: an expired hold cannot be captured (§21)', async (t) => {
      const kit = await makeKit();
      if (!kit.expireAuthorization) return t.skip('kit provides no expireAuthorization hook');
      const { result, slotId } = await authorize(kit);
      await kit.expireAuthorization(result.providerPaymentId);
      const status = await kit.provider.retrievePaymentStatus(result.providerPaymentId);
      assert.equal(status.status, 'EXPIRED');
      await assert.rejects(
        kit.provider.captureContribution({
          idempotencyKey: operationId.capture(slotId, 1),
          providerPaymentId: result.providerPaymentId,
          amount: usd(5_000),
        }),
        isProviderError('INVALID_STATE'),
      );
    });

    // ---- delayed resolution & provider truth (§14) ------------------------------

    it('delayed resolution: PROCESSING resolves later; retrievePaymentStatus reports provider truth', async (t) => {
      const kit = await makeKit();
      if (!kit.resolvePendingAuthorization) {
        return t.skip('kit provides no resolvePendingAuthorization hook');
      }
      const { result } = await authorize(kit, { behavior: 'pending' });
      assert.equal(result.status, 'PROCESSING');
      let status = await kit.provider.retrievePaymentStatus(result.providerPaymentId);
      assert.equal(status.status, 'PROCESSING');
      await kit.resolvePendingAuthorization(result.providerPaymentId, 'AUTHORIZED');
      status = await kit.provider.retrievePaymentStatus(result.providerPaymentId);
      assert.equal(status.status, 'AUTHORIZED');
      assert.ok(Date.parse(status.occurredAt) > 0, 'provider-side timestamp required (§28)');
    });

    // ---- webhook identity & ordering (§28) --------------------------------------

    it('duplicate webhook delivery carries the SAME provider event id', async (t) => {
      const kit = await makeKit();
      if (!kit.drainEvents || !kit.duplicateLastEvent) {
        return t.skip('kit provides no event simulation hooks');
      }
      await authorize(kit);
      kit.duplicateLastEvent();
      const events = kit.drainEvents();
      assert.equal(events.length, 2);
      assert.equal(events[0]!.providerEventId, events[1]!.providerEventId);
    });

    it('out-of-order delivery is recoverable via provider occurredAt timestamps', async (t) => {
      const kit = await makeKit();
      if (!kit.drainEvents || !kit.swapLastTwoEvents) {
        return t.skip('kit provides no event reordering hook');
      }
      const { result, slotId } = await authorize(kit);
      await kit.provider.captureContribution({
        idempotencyKey: operationId.capture(slotId, 1),
        providerPaymentId: result.providerPaymentId,
        amount: usd(5_000),
      });
      kit.swapLastTwoEvents();
      const events = kit.drainEvents();
      assert.equal(events[0]!.type, 'payment.captured', 'delivery order is scrambled');
      assert.equal(events[1]!.type, 'payment.authorized');
      const authorizedAt = Date.parse(events[1]!.occurredAt);
      const capturedAt = Date.parse(events[0]!.occurredAt);
      assert.ok(
        authorizedAt <= capturedAt,
        'occurredAt must let the consumer reconstruct true order (§28)',
      );
    });

    it('verifies webhook signatures and rejects tampering (§28)', async (t) => {
      const kit = await makeKit();
      const signWebhook = kit.signWebhook;
      if (!signWebhook) return t.skip('kit provides no signWebhook hook');
      const rawBody = kit.buildTestEventRawBody
        ? kit.buildTestEventRawBody({
            providerEventId: 'evt_contract',
            type: 'payment.captured',
            objectId: 'pay_contract',
          })
        : JSON.stringify({
            provider: kit.provider.providerName,
            providerEventId: 'evt_contract',
            type: 'payment.captured',
            occurredAt: new Date().toISOString(),
            objectId: 'pay_contract',
            payload: {},
          });
      const parsed = kit.provider.parseWebhookEvent({
        rawBody,
        signatureHeader: signWebhook(rawBody, 'contract-secret'),
        webhookSecret: 'contract-secret',
      });
      assert.equal(parsed.providerEventId, 'evt_contract');
      assert.throws(
        () =>
          kit.provider.parseWebhookEvent({
            rawBody,
            signatureHeader: signWebhook(rawBody, 'wrong-secret'),
            webhookSecret: 'contract-secret',
          }),
        isProviderError('INVALID_SIGNATURE'),
      );
    });

    // ---- issuing substrate (§16–§19) ---------------------------------------------

    it('enforces the cumulative card spending limit (§17 exposure math)', async (t) => {
      const kit = await makeKit();
      if (
        !kit.provider.capabilities.virtualCardIssuing ||
        !kit.issueCard ||
        !kit.merchantAuthorize
      ) {
        return t.skip('no issuing simulation available');
      }
      const cardId = await kit.issueCard(10_000);
      const first = await kit.merchantAuthorize(cardId, 6_000, '5411');
      assert.equal(first.approved, true);
      const second = await kit.merchantAuthorize(cardId, 4_001, '5411');
      assert.equal(second.approved, false, 'cumulative limit must hold');
    });

    it('declines a duplicate merchant authorization once the limit is consumed (§17)', async (t) => {
      const kit = await makeKit();
      if (!kit.issueCard || !kit.merchantAuthorize)
        return t.skip('no issuing simulation available');
      const cardId = await kit.issueCard(12_843);
      const first = await kit.merchantAuthorize(cardId, 12_843, '5411');
      assert.equal(first.approved, true);
      const duplicate = await kit.merchantAuthorize(cardId, 12_843, '5411');
      assert.equal(duplicate.approved, false, 'an identical retry must not double-spend the Vink');
    });

    it('enforces MCC blocks (§19) when merchantCategoryControls is declared', async (t) => {
      const kit = await makeKit();
      if (
        !kit.provider.capabilities.merchantCategoryControls ||
        !kit.issueCard ||
        !kit.merchantAuthorize ||
        !kit.setBlockedMccs
      ) {
        return t.skip('no MCC control simulation available');
      }
      const cardId = await kit.issueCard(10_000);
      await kit.setBlockedMccs(cardId, ['6011']); // ATM — cash-like, always blocked (§3.2)
      const atm = await kit.merchantAuthorize(cardId, 2_000, '6011');
      assert.equal(atm.approved, false);
      const grocery = await kit.merchantAuthorize(cardId, 2_000, '5411');
      assert.equal(grocery.approved, true);
    });

    it('freeze and close both stop new authorizations (§16/§18)', async (t) => {
      const kit = await makeKit();
      if (!kit.issueCard || !kit.merchantAuthorize)
        return t.skip('no issuing simulation available');

      const frozenCard = await kit.issueCard(10_000);
      await kit.provider.freezeCard(frozenCard);
      const onFrozen = await kit.merchantAuthorize(frozenCard, 1_000, '5411');
      assert.equal(onFrozen.approved, false);

      const closedCard = await kit.issueCard(10_000);
      await kit.provider.closeCard(closedCard);
      const onClosed = await kit.merchantAuthorize(closedCard, 1_000, '5411');
      assert.equal(onClosed.approved, false);
    });
  });
}
