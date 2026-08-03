import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  policyForCategory,
  evaluateExactFinalSettlement,
  assertExactFinalRequiredAmount,
} from './policy.ts';
import { money } from './money.ts';
import { DomainError } from './errors.ts';

const isDomainError = (code: string) => (error: unknown) =>
  error instanceof DomainError && error.code === code;

describe('Policy engine (Plan §16)', () => {
  it('maps grocery, retail and electronics to a supported EXACT_FINAL policy', () => {
    for (const category of ['GROCERY', 'RETAIL', 'ELECTRONICS'] as const) {
      const policy = policyForCategory(category);
      assert.equal(policy.policyType, 'EXACT_FINAL');
      assert.equal(policy.supported, true);
      assert.deepEqual(policy.settlementVarianceRule, { kind: 'NONE_ALLOWED' });
    }
  });

  it('rejects high-variance categories outright during MVP', () => {
    for (const category of ['HOTEL', 'FUEL', 'CAR_RENTAL'] as const) {
      assert.throws(
        () => policyForCategory(category),
        isDomainError('UNSUPPORTED_PURCHASE_CATEGORY'),
      );
    }
  });

  it('rejects RESTAURANT unless the restaurant_variable_policy flag is on', () => {
    assert.throws(
      () => policyForCategory('RESTAURANT'),
      isDomainError('UNSUPPORTED_PURCHASE_CATEGORY'),
    );
    const policy = policyForCategory('RESTAURANT', { restaurantVariableEnabled: true });
    assert.equal(policy.policyType, 'RESTAURANT_VARIABLE');
    assert.equal(policy.supported, true);
  });

  describe('EXACT_FINAL settlement evaluation (journey E7)', () => {
    it('matches when settled equals funded', () => {
      assert.deepEqual(evaluateExactFinalSettlement(money(10_000), money(10_000)), {
        outcome: 'MATCHED',
      });
    });

    it('creates an organizer recovery amount on overage — participants are never recharged', () => {
      const result = evaluateExactFinalSettlement(money(10_000), money(11_500));
      assert.equal(result.outcome, 'OVERAGE');
      assert.equal(result.outcome === 'OVERAGE' ? result.recoveryAmount.amountMinor : -1, 1500);
    });

    it('reports unused amount on underage', () => {
      const result = evaluateExactFinalSettlement(money(10_000), money(9_000));
      assert.equal(result.outcome, 'UNDERAGE');
      assert.equal(result.outcome === 'UNDERAGE' ? result.unusedAmount.amountMinor : -1, 1000);
    });
  });

  it('enforces required = subtotal + tip for EXACT_FINAL', () => {
    assertExactFinalRequiredAmount(money(11_000), money(10_000), money(1_000));
    assert.throws(
      () => assertExactFinalRequiredAmount(money(11_001), money(10_000), money(1_000)),
      isDomainError('POLICY_VIOLATION'),
    );
  });
});
