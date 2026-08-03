import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockDeliveryProvider } from './mock-delivery-provider.ts';

const TEMPLATE = {
  kind: 'guest_invite' as const,
  organizerName: 'Alvin',
  purpose: 'Grocery run',
  yourShareMinor: 4_000,
  deadline: '2026-07-22T00:00:00Z',
  link: 'https://vinkin.example/g/abc',
};

describe('MockDeliveryProvider', () => {
  it('accepts a send and records it', async () => {
    const provider = new MockDeliveryProvider();
    const result = await provider.send({
      destination: 'guest@example.com',
      method: 'EMAIL',
      template: TEMPLATE,
    });
    assert.equal(result.accepted, true);
    assert.ok(result.providerMessageId);
    assert.equal(provider.sent.length, 1);
    assert.equal(provider.sent[0]!.destination, 'guest@example.com');
  });

  it('simulateFailureFor makes exactly the next send to that destination fail, never throw', async () => {
    const provider = new MockDeliveryProvider();
    provider.simulateFailureFor('guest@example.com');
    const failed = await provider.send({
      destination: 'guest@example.com',
      method: 'EMAIL',
      template: TEMPLATE,
    });
    assert.equal(failed.accepted, false);
    assert.equal(failed.failureReason, 'MOCK_SIMULATED_FAILURE');

    // One-shot: the next send to the same destination succeeds again.
    const retried = await provider.send({
      destination: 'guest@example.com',
      method: 'EMAIL',
      template: TEMPLATE,
    });
    assert.equal(retried.accepted, true);
  });

  it('a failure for one destination never affects another', async () => {
    const provider = new MockDeliveryProvider();
    provider.simulateFailureFor('a@example.com');
    const b = await provider.send({
      destination: 'b@example.com',
      method: 'EMAIL',
      template: TEMPLATE,
    });
    assert.equal(b.accepted, true);
  });
});
