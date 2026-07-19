import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeHub } from './hub.ts';

describe('RealtimeHub', () => {
  it('delivers a published message to every subscriber of that vink only', () => {
    const hub = new RealtimeHub();
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    const receivedOther: unknown[] = [];
    hub.subscribe('vink-1', (m) => receivedA.push(m));
    hub.subscribe('vink-1', (m) => receivedB.push(m));
    hub.subscribe('vink-2', (m) => receivedOther.push(m));

    hub.publish('vink-1', { type: 'vink_funded' });

    assert.deepEqual(receivedA, [{ type: 'vink_funded' }]);
    assert.deepEqual(receivedB, [{ type: 'vink_funded' }]);
    assert.deepEqual(receivedOther, []);
  });

  it('unsubscribe stops delivery and cleans up empty channels', () => {
    const hub = new RealtimeHub();
    const received: unknown[] = [];
    const unsubscribe = hub.subscribe('vink-1', (m) => received.push(m));
    assert.equal(hub.subscriberCount('vink-1'), 1);
    unsubscribe();
    assert.equal(hub.subscriberCount('vink-1'), 0);
    hub.publish('vink-1', { type: 'vink_funded' });
    assert.deepEqual(received, []);
  });

  it('publishing to a channel with no subscribers is a harmless no-op', () => {
    const hub = new RealtimeHub();
    assert.doesNotThrow(() => hub.publish('nobody-here', { type: 'vink_funded' }));
  });
});
