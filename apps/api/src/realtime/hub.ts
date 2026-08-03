/**
 * Realtime fanout (Plan §14 channel `vink:{vinkId}`). Two implementations behind one
 * interface (D16): `RedisRealtimeHub` for `server.ts` (production-shaped — works across
 * multiple API instances), `InProcessRealtimeHub` for unit tests that don't need
 * infrastructure. `subscribe`/`publish` return `Promise` because the Redis implementation
 * genuinely awaits network calls; the in-process one resolves synchronously.
 */

export type Unsubscribe = () => void | Promise<void>;

export interface RealtimeHub {
  subscribe(vinkId: string, listener: (message: unknown) => void): Promise<Unsubscribe>;
  publish(vinkId: string, message: unknown): Promise<void>;
  /** Local-instance subscriber count only — never a cluster-wide total (flagged). */
  subscriberCount(vinkId: string): number;
}

export class InProcessRealtimeHub implements RealtimeHub {
  readonly #subscribers = new Map<string, Set<(message: unknown) => void>>();

  async subscribe(vinkId: string, listener: (message: unknown) => void): Promise<Unsubscribe> {
    let set = this.#subscribers.get(vinkId);
    if (set === undefined) {
      set = new Set();
      this.#subscribers.set(vinkId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.#subscribers.delete(vinkId);
    };
  }

  async publish(vinkId: string, message: unknown): Promise<void> {
    for (const listener of this.#subscribers.get(vinkId) ?? []) listener(message);
  }

  subscriberCount(vinkId: string): number {
    return this.#subscribers.get(vinkId)?.size ?? 0;
  }
}
