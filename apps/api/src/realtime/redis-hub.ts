/**
 * Redis-backed realtime hub (D16) — the production-shaped `RealtimeHub`: any API instance
 * publishing an event reaches every instance's local WebSocket subscribers, not just its
 * own. Needs two ioredis connections: one for PUBLISH (regular command mode) and one
 * dedicated to SUBSCRIBE (ioredis puts a connection into subscriber-only mode the moment
 * `.subscribe()` is called — it can never issue another kind of command afterwards).
 *
 * Local channel subscriptions are reference-counted: the Redis SUBSCRIBE only fires on the
 * first local listener for a vink and UNSUBSCRIBE only on the last, so N local WebSocket
 * clients on the same vink cost one Redis channel, not N.
 */

import type { Redis } from 'ioredis';
import type { RealtimeHub, Unsubscribe } from './hub.ts';

const CHANNEL_PREFIX = 'vinkin:realtime:vink:';

export class RedisRealtimeHub implements RealtimeHub {
  readonly #pub: Redis;
  readonly #sub: Redis;
  readonly #localListeners = new Map<string, Set<(message: unknown) => void>>();

  constructor(pub: Redis, sub: Redis) {
    this.#pub = pub;
    this.#sub = sub;
    this.#sub.on('message', (channel: string, raw: string) => {
      if (!channel.startsWith(CHANNEL_PREFIX)) return;
      const vinkId = channel.slice(CHANNEL_PREFIX.length);
      const listeners = this.#localListeners.get(vinkId);
      if (listeners === undefined || listeners.size === 0) return;
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        return; // not our format; ignore rather than crash the subscriber connection
      }
      for (const listener of listeners) listener(message);
    });
  }

  async subscribe(vinkId: string, listener: (message: unknown) => void): Promise<Unsubscribe> {
    let set = this.#localListeners.get(vinkId);
    const isFirstLocalListener = set === undefined;
    if (set === undefined) {
      set = new Set();
      this.#localListeners.set(vinkId, set);
    }
    set.add(listener);
    if (isFirstLocalListener) await this.#sub.subscribe(CHANNEL_PREFIX + vinkId);

    return async () => {
      const current = this.#localListeners.get(vinkId);
      if (current === undefined) return;
      current.delete(listener);
      if (current.size === 0) {
        this.#localListeners.delete(vinkId);
        await this.#sub.unsubscribe(CHANNEL_PREFIX + vinkId);
      }
    };
  }

  async publish(vinkId: string, message: unknown): Promise<void> {
    await this.#pub.publish(CHANNEL_PREFIX + vinkId, JSON.stringify(message));
  }

  subscriberCount(vinkId: string): number {
    return this.#localListeners.get(vinkId)?.size ?? 0;
  }
}
