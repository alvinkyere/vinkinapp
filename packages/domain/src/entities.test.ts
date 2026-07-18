import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertParticipantIdentity,
  assertWithinApprovedMaximum,
  assertVinkAmounts,
  assertCardDisplaySafety,
} from './entities.ts';
import { money } from './money.ts';
import { DomainError } from './errors.ts';
import {
  idempotencyKey,
  newVinkId,
  newParticipantId,
  newContributionId,
  newUserId,
  newGuestIdentityId,
  newPurchaseAuthorizationId,
} from './ids.ts';

const isInvariantViolation = (error: unknown) =>
  error instanceof DomainError && error.code === 'INVARIANT_VIOLATION';

describe('Entity invariants (Plan §7, Spec §4.7)', () => {
  it('participant must have exactly one of userId or guestIdentityId', () => {
    assertParticipantIdentity({ userId: newUserId(), guestIdentityId: null });
    assertParticipantIdentity({ userId: null, guestIdentityId: newGuestIdentityId() });
    assert.throws(
      () => assertParticipantIdentity({ userId: null, guestIdentityId: null }),
      isInvariantViolation,
    );
    assert.throws(
      () =>
        assertParticipantIdentity({ userId: newUserId(), guestIdentityId: newGuestIdentityId() }),
      isInvariantViolation,
    );
  });

  it('never allows a charge beyond the approved maximum (§4.7)', () => {
    assertWithinApprovedMaximum(money(4_000), money(4_000), 'capture');
    assert.throws(
      () => assertWithinApprovedMaximum(money(4_001), money(4_000), 'capture'),
      isInvariantViolation,
    );
  });

  it('vink amounts: required and funded never exceed maximum', () => {
    assertVinkAmounts({
      requiredAmount: money(10_000),
      maximumAmount: money(11_000),
      fundedAmount: money(0),
    });
    assert.throws(
      () =>
        assertVinkAmounts({
          requiredAmount: money(12_000),
          maximumAmount: money(11_000),
          fundedAmount: money(0),
        }),
      isInvariantViolation,
    );
    assert.throws(
      () =>
        assertVinkAmounts({
          requiredAmount: money(10_000),
          maximumAmount: money(11_000),
          fundedAmount: money(11_001),
        }),
      isInvariantViolation,
    );
  });

  it('card records may carry only four display digits — never PAN/CVV shapes', () => {
    assertCardDisplaySafety({ displayLastFour: '4242' });
    assert.throws(
      () => assertCardDisplaySafety({ displayLastFour: '4242424242424242' }),
      isInvariantViolation,
    );
    assert.throws(() => assertCardDisplaySafety({ displayLastFour: '123' }), isInvariantViolation);
    assert.throws(() => assertCardDisplaySafety({ displayLastFour: 'abcd' }), isInvariantViolation);
  });

  it('idempotency keys follow the Plan §11 formats verbatim and are stable', () => {
    const vinkId = newVinkId();
    const participantId = newParticipantId();
    const contributionId = newContributionId();
    const authorizationId = newPurchaseAuthorizationId();

    assert.equal(
      idempotencyKey.authorizeContribution(vinkId, participantId, 1),
      `vink:${vinkId}:participant:${participantId}:authorize:1`,
    );
    assert.equal(
      idempotencyKey.captureContribution(vinkId, contributionId),
      `vink:${vinkId}:contribution:${contributionId}:capture`,
    );
    assert.equal(idempotencyKey.issueCard(vinkId), `vink:${vinkId}:issue-card`);
    assert.equal(
      idempotencyKey.capturePurchaseAuthorization(vinkId, authorizationId),
      `vink:${vinkId}:authorization:${authorizationId}:capture`,
    );
    assert.equal(
      idempotencyKey.refundContribution(vinkId, contributionId),
      `vink:${vinkId}:contribution:${contributionId}:refund`,
    );

    // Same command, same key — a retry reuses the key rather than minting a new one (E5).
    assert.equal(
      idempotencyKey.authorizeContribution(vinkId, participantId, 1),
      idempotencyKey.authorizeContribution(vinkId, participantId, 1),
    );
    // A new attempt generation is a different command with a different key.
    assert.notEqual(
      idempotencyKey.authorizeContribution(vinkId, participantId, 1),
      idempotencyKey.authorizeContribution(vinkId, participantId, 2),
    );
  });
});
