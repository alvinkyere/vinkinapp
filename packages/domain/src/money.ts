/**
 * Money value object — integer minor units only, floats rejected at runtime (Plan §15,
 * Spec §26). Shape-compatible with `@vinkin/payment-provider`'s Money so values cross the
 * provider boundary without mapping; the domain additionally allows zero (a Vink's
 * funded_amount starts at 0) while provider operation amounts stay strictly positive.
 */

import { DomainError } from './errors.ts';

export type CurrencyCode = 'USD'; // USD-only in V1 (Spec §36)

export interface Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export function money(amountMinor: number, currency: CurrencyCode = 'USD'): Money {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new DomainError(
      'INVALID_MONEY',
      `amountMinor must be a non-negative safe integer, got ${amountMinor}`,
    );
  }
  return { amountMinor, currency };
}

export function zero(currency: CurrencyCode = 'USD'): Money {
  return { amountMinor: 0, currency };
}

export function assertSameCurrency(a: Money, b: Money, operation: string): void {
  if (a.currency !== b.currency) {
    throw new DomainError('CURRENCY_MISMATCH', `${operation}: ${a.currency} vs ${b.currency}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b, 'addMoney');
  return money(a.amountMinor + b.amountMinor, a.currency);
}

/** Throws INVALID_MONEY if the result would be negative — no domain amount may go below zero. */
export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b, 'subtractMoney');
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function sumMoney(amounts: readonly Money[], currency: CurrencyCode = 'USD'): Money {
  return amounts.reduce(addMoney, zero(currency));
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b, 'compareMoney');
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

export function moneyEquals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

export function isZero(a: Money): boolean {
  return a.amountMinor === 0;
}
