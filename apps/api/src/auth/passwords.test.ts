import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './passwords.ts';

describe('password hashing (scrypt)', () => {
  it('verifies the original password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery staple');
    assert.equal(await verifyPassword('correct horse battery staple', stored), true);
    assert.equal(await verifyPassword('incorrect horse', stored), false);
  });

  it('salts: the same password hashes differently each time', async () => {
    const first = await hashPassword('same-password');
    const second = await hashPassword('same-password');
    assert.notEqual(first, second);
    assert.equal(await verifyPassword('same-password', second), true);
  });

  it('rejects malformed stored values without throwing', async () => {
    assert.equal(await verifyPassword('anything', 'not-a-valid-record'), false);
    assert.equal(await verifyPassword('anything', 'bcrypt:aa:bb'), false);
  });
});
