import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  money,
  zero,
  addMoney,
  subtractMoney,
  sumMoney,
  compareMoney,
  moneyEquals,
  isZero,
} from './money.ts';
import { DomainError } from './errors.ts';

const isDomainError = (code: string) => (error: unknown) =>
  error instanceof DomainError && error.code === code;

describe('Money value object (integer minor units)', () => {
  it('constructs from non-negative safe integers only', () => {
    assert.deepEqual(money(0), { amountMinor: 0, currency: 'USD' });
    assert.deepEqual(money(12_345), { amountMinor: 12_345, currency: 'USD' });
  });

  it('rejects floats — never floating-point arithmetic for money (Plan §15)', () => {
    assert.throws(() => money(10.5), isDomainError('INVALID_MONEY'));
    assert.throws(() => money(0.1 + 0.2), isDomainError('INVALID_MONEY'));
  });

  it('rejects negatives, NaN, Infinity and unsafe integers', () => {
    assert.throws(() => money(-1), isDomainError('INVALID_MONEY'));
    assert.throws(() => money(Number.NaN), isDomainError('INVALID_MONEY'));
    assert.throws(() => money(Number.POSITIVE_INFINITY), isDomainError('INVALID_MONEY'));
    assert.throws(() => money(Number.MAX_SAFE_INTEGER + 1), isDomainError('INVALID_MONEY'));
  });

  it('adds and subtracts in minor units', () => {
    assert.equal(addMoney(money(3334), money(3333)).amountMinor, 6667);
    assert.equal(subtractMoney(money(10_000), money(3333)).amountMinor, 6667);
  });

  it('refuses subtraction below zero — no negative domain amounts', () => {
    assert.throws(() => subtractMoney(money(100), money(101)), isDomainError('INVALID_MONEY'));
  });

  it('sums a list and treats the empty list as zero', () => {
    assert.equal(sumMoney([money(1), money(2), money(3)]).amountMinor, 6);
    assert.equal(sumMoney([]).amountMinor, 0);
  });

  it('compares and tests equality/zero', () => {
    assert.equal(compareMoney(money(1), money(2)), -1);
    assert.equal(compareMoney(money(2), money(2)), 0);
    assert.equal(compareMoney(money(3), money(2)), 1);
    assert.equal(moneyEquals(money(5), money(5)), true);
    assert.equal(isZero(zero()), true);
    assert.equal(isZero(money(1)), false);
  });
});
