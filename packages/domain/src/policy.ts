/**
 * Purchase-policy types and exact-final evaluation — Plan §16.
 *
 * PV2 implements the EXACT_FINAL policy fully. RESTAURANT_VARIABLE exists as a type and a
 * category mapping but evaluates as unsupported unless the `restaurant_variable_policy`
 * feature flag (governance doc §4) is passed in — no silent enablement.
 * VARIABLE_SETTLEMENT_UNSUPPORTED categories are rejected outright during MVP.
 */

import type { Money } from './money.ts';
import { compareMoney, subtractMoney } from './money.ts';
import { DomainError } from './errors.ts';

export type PolicyType = 'EXACT_FINAL' | 'RESTAURANT_VARIABLE' | 'VARIABLE_SETTLEMENT_UNSUPPORTED';

export type PurchaseCategory =
  'GROCERY' | 'RETAIL' | 'ELECTRONICS' | 'RESTAURANT' | 'HOTEL' | 'FUEL' | 'CAR_RENTAL';

export interface MerchantCategoryRule {
  mcc: string;
  allowed: boolean;
}

export type SettlementVarianceRule =
  | { kind: 'NONE_ALLOWED' } // EXACT_FINAL: any overage creates recovery or manual review
  | { kind: 'MAX_TIP_BASIS_POINTS'; maximumTipBasisPoints: number }
  | { kind: 'UNSUPPORTED' };

export interface PurchasePolicy {
  policyType: PolicyType;
  supported: boolean;
  maximumTipBasisPoints?: number;
  merchantCategoryRules: MerchantCategoryRule[];
  authorizationVarianceLimit?: Money;
  settlementVarianceRule: SettlementVarianceRule;
}

const CATEGORY_POLICY: Readonly<Record<PurchaseCategory, PolicyType>> = {
  GROCERY: 'EXACT_FINAL',
  RETAIL: 'EXACT_FINAL',
  ELECTRONICS: 'EXACT_FINAL',
  RESTAURANT: 'RESTAURANT_VARIABLE',
  HOTEL: 'VARIABLE_SETTLEMENT_UNSUPPORTED',
  FUEL: 'VARIABLE_SETTLEMENT_UNSUPPORTED',
  CAR_RENTAL: 'VARIABLE_SETTLEMENT_UNSUPPORTED',
};

export interface PolicyEvaluationOptions {
  /** Governance §4 `restaurant_variable_policy` flag; default off. */
  restaurantVariableEnabled?: boolean;
}

/**
 * Resolves the policy for a purchase category. Throws UNSUPPORTED_PURCHASE_CATEGORY for
 * variable-settlement categories (Plan §16: "The API must reject these categories during
 * MVP") and for RESTAURANT unless the feature flag is on.
 */
export function policyForCategory(
  category: PurchaseCategory,
  options: PolicyEvaluationOptions = {},
): PurchasePolicy {
  const policyType = CATEGORY_POLICY[category];

  if (policyType === 'VARIABLE_SETTLEMENT_UNSUPPORTED') {
    throw new DomainError(
      'UNSUPPORTED_PURCHASE_CATEGORY',
      `Category ${category} has high-variance settlement and is not supported in MVP`,
    );
  }

  if (policyType === 'RESTAURANT_VARIABLE') {
    if (options.restaurantVariableEnabled !== true) {
      throw new DomainError(
        'UNSUPPORTED_PURCHASE_CATEGORY',
        `Category ${category} requires the restaurant_variable_policy feature flag (off by default; provider and counsel validation pending)`,
      );
    }
    return {
      policyType: 'RESTAURANT_VARIABLE',
      supported: true,
      merchantCategoryRules: [],
      settlementVarianceRule: { kind: 'MAX_TIP_BASIS_POINTS', maximumTipBasisPoints: 3000 },
      maximumTipBasisPoints: 3000,
    };
  }

  return {
    policyType: 'EXACT_FINAL',
    supported: true,
    merchantCategoryRules: [],
    settlementVarianceRule: { kind: 'NONE_ALLOWED' },
  };
}

export type ExactFinalSettlementOutcome =
  | { outcome: 'MATCHED' }
  | { outcome: 'UNDERAGE'; unusedAmount: Money }
  | { outcome: 'OVERAGE'; recoveryAmount: Money };

/**
 * EXACT_FINAL settlement rule (Plan §16, journey E7): settlement above the funded amount
 * creates an organizer recovery amount — participants are never recharged (Spec §4.7).
 */
export function evaluateExactFinalSettlement(
  fundedAmount: Money,
  settledAmount: Money,
): ExactFinalSettlementOutcome {
  const comparison = compareMoney(settledAmount, fundedAmount);
  if (comparison === 0) return { outcome: 'MATCHED' };
  if (comparison < 0)
    return { outcome: 'UNDERAGE', unusedAmount: subtractMoney(fundedAmount, settledAmount) };
  return { outcome: 'OVERAGE', recoveryAmount: subtractMoney(settledAmount, fundedAmount) };
}

/** EXACT_FINAL: required amount equals the exact checkout total (subtotal + tip). */
export function assertExactFinalRequiredAmount(
  requiredAmount: Money,
  subtotalAmount: Money,
  tipAmount: Money,
): void {
  if (requiredAmount.amountMinor !== subtotalAmount.amountMinor + tipAmount.amountMinor) {
    throw new DomainError(
      'POLICY_VIOLATION',
      `EXACT_FINAL requires requiredAmount (${requiredAmount.amountMinor}) = subtotal (${subtotalAmount.amountMinor}) + tip (${tipAmount.amountMinor})`,
    );
  }
}
