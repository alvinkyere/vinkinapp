import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { simulatorRoutesPermitted } from './simulator-guard.ts';
import { VINKIN_ENVIRONMENTS } from './env.ts';

describe('simulator environment guard (governance §5)', () => {
  it('permits exactly development, test and demo — an allowlist, not a not-production check', () => {
    const permitted = VINKIN_ENVIRONMENTS.filter((env) => simulatorRoutesPermitted(env));
    assert.deepEqual(permitted, ['development', 'test', 'demo']);
  });

  it('blocks staging and production', () => {
    assert.equal(simulatorRoutesPermitted('staging'), false);
    assert.equal(simulatorRoutesPermitted('production'), false);
  });
});
