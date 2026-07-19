/**
 * In-process pub/sub keyed by vinkId (Plan §14 channel `vink:{vinkId}`). One API instance
 * for the validation build — a real deployment fans this out through Redis pub/sub instead;
 * the subscribe/publish shape here is deliberately that interface's shape so the swap is
 * mechanical (flagged in the PV8 report).
 */

export type Unsubscribe = () => void;

export class RealtimeHub {
  readonly #subscribers = new Map<string, Set<(message: unknown) => void>>();

  subscribe(vinkId: string, listener: (message: unknown) => void): Unsubscribe {
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

  publish(vinkId: string, message: unknown): void {
    for (const listener of this.#subscribers.get(vinkId) ?? []) listener(message);
  }

  subscriberCount(vinkId: string): number {
    return this.#subscribers.get(vinkId)?.size ?? 0;
  }
}
