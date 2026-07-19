import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InProcessRealtimeHub } from './hub.ts';

describe('InProcessRealtimeHub', () => {
  it('delivers a published message to every subscriber of that vink only', async () => {
    const hub = new InProcessRealtimeHub();
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    const receivedOther: unknown[] = [];
    await hub.subscribe('vink-1', (m) => receivedA.push(m));
    await hub.subscribe('vink-1', (m) => receivedB.push(m));
    await hub.subscribe('vink-2', (m) => receivedOther.push(m));

    await hub.publish('vink-1', { type: 'vink_funded' });

    assert.deepEqual(receivedA, [{ type: 'vink_funded' }]);
    assert.deepEqual(receivedB, [{ type: 'vink_funded' }]);
    assert.deepEqual(receivedOther, []);
  });

  it('unsubscribe stops delivery and cleans up empty channels', async () => {
    const hub = new InProcessRealtimeHub();
    const received: unknown[] = [];
    const unsubscribe = await hub.subscribe('vink-1', (m) => received.push(m));
    assert.equal(hub.subscriberCount('vink-1'), 1);
    await unsubscribe();
    assert.equal(hub.subscriberCount('vink-1'), 0);
    await hub.publish('vink-1', { type: 'vink_funded' });
    assert.deepEqual(received, []);
  });

  it('publishing to a channel with no subscribers is a harmless no-op', async () => {
    const hub = new InProcessRealtimeHub();
    await assert.doesNotReject(hub.publish('nobody-here', { type: 'vink_funded' }));
  });
});
