/**
 * RedisRealtimeHub — proves the actual property D16 exists for: a message published by ONE
 * hub instance (standing in for one API process) reaches a listener subscribed through a
 * DIFFERENT hub instance (standing in for another API process), because both are backed by
 * the same Redis. This is what `InProcessRealtimeHub` structurally cannot do — the PV8 hub
 * was flagged single-process-only for exactly this reason. Requires real Redis;
 * VINKIN_INTEGRATION=1.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from '../config/env.ts';
import { createRedis } from '../redis/client.ts';
import { RedisRealtimeHub } from './redis-hub.ts';

const RUN = process.env.VINKIN_INTEGRATION === '1';

async function waitFor(
  collected: readonly unknown[],
  predicate: (message: unknown) => boolean,
  timeoutMs = 3_000,
): Promise<unknown> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = collected.find(predicate);
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for a matching message');
}

describe('RedisRealtimeHub (real Redis)', { skip: !RUN }, () => {
  const env = loadEnv({ ...process.env, VINKIN_ENV: 'test' });
  let hub1: RedisRealtimeHub;
  let hub2: RedisRealtimeHub;
  const connections: Array<{ disconnect(): void }> = [];

  function makeHub(): RedisRealtimeHub {
    const pub = createRedis(env);
    const sub = createRedis(env);
    connections.push(pub, sub);
    return new RedisRealtimeHub(pub, sub);
  }

  before(() => {
    hub1 = makeHub();
    hub2 = makeHub();
  });

  after(() => {
    for (const connection of connections) connection.disconnect();
  });

  it('EXIT PROOF: a message published on one hub instance reaches a listener on another', async () => {
    const vinkId = `cross-instance-${Date.now()}`;
    const received: unknown[] = [];
    await hub2.subscribe(vinkId, (message) => received.push(message));

    await hub1.publish(vinkId, { type: 'vink_funded', vinkId });

    const message = await waitFor(received, (m) => (m as { type: string }).type === 'vink_funded');
    assert.deepEqual(message, { type: 'vink_funded', vinkId });
  });

  it('an instance does not receive messages for a vink it never subscribed to', async () => {
    const vinkId = `no-subscription-${Date.now()}`;
    const received: unknown[] = [];
    await hub2.subscribe(`other-${vinkId}`, (message) => received.push(message));

    await hub1.publish(vinkId, { type: 'vink_funded' });
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.deepEqual(received, []);
  });

  it('unsubscribing the last local listener actually stops Redis delivery, not just local bookkeeping', async () => {
    const vinkId = `unsubscribe-${Date.now()}`;
    const received: unknown[] = [];
    const unsubscribe = await hub2.subscribe(vinkId, (message) => received.push(message));

    await hub1.publish(vinkId, { type: 'first' });
    await waitFor(received, (m) => (m as { type: string }).type === 'first');

    await unsubscribe();
    assert.equal(hub2.subscriberCount(vinkId), 0);

    await hub1.publish(vinkId, { type: 'second' });
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.deepEqual(received, [{ type: 'first' }]); // "second" never arrives
  });

  it('reference-counts local listeners: one unsubscribe among two leaves delivery intact', async () => {
    const vinkId = `refcount-${Date.now()}`;
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    const unsubscribeA = await hub2.subscribe(vinkId, (m) => receivedA.push(m));
    await hub2.subscribe(vinkId, (m) => receivedB.push(m));
    assert.equal(hub2.subscriberCount(vinkId), 2);

    await unsubscribeA();
    assert.equal(hub2.subscriberCount(vinkId), 1);

    await hub1.publish(vinkId, { type: 'still-flowing' });
    await waitFor(receivedB, (m) => (m as { type: string }).type === 'still-flowing');
    assert.deepEqual(receivedA, []); // A unsubscribed, never sees it
  });
});
