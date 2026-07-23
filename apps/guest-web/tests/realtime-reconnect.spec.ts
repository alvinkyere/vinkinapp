// ENG3: pure-logic test for `reconnectDelayMs` (exponential backoff with jitter), same
// pure-Playwright-test-no-page-fixture pattern as guest-copy.spec.ts — see that file's own
// header comment for why this repo runs pure-function tests through Playwright directly.

import { test, expect } from '@playwright/test';
import { reconnectDelayMs } from '../features/join/use-guest-realtime';

test.describe('ENG3: reconnectDelayMs — exponential backoff with jitter', () => {
  test('attempt 0 is centered on the 1s base delay', () => {
    // jitter factor at random()==0.5 is 0.8 + 0.5*0.4 == 1.0 exactly.
    expect(reconnectDelayMs(0, () => 0.5)).toBe(1000);
  });

  test('delay grows monotonically with attempt, before hitting the cap', () => {
    const d0 = reconnectDelayMs(0, () => 0.5);
    const d1 = reconnectDelayMs(1, () => 0.5);
    const d2 = reconnectDelayMs(2, () => 0.5);
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
    expect(d1).toBe(2000);
    expect(d2).toBe(4000);
  });

  test('delay never exceeds the 30s cap, however large the attempt number', () => {
    expect(reconnectDelayMs(20, () => 0.5)).toBeLessThanOrEqual(30_000);
  });

  test('jitter stays within ±20% of the exponential value at both extremes', () => {
    // attempt 3: exponential base 8000ms.
    expect(reconnectDelayMs(3, () => 0)).toBe(6400); // 8000 * 0.8
    expect(reconnectDelayMs(3, () => 1)).toBe(9600); // 8000 * 1.2
  });

  test('never produces a zero or negative delay even at attempt 0 with minimum jitter', () => {
    expect(reconnectDelayMs(0, () => 0)).toBeGreaterThan(0);
  });
});
