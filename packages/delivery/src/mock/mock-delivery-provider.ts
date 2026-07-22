import type { DeliveryProvider } from '../provider.ts';
import type { DeliveryInput, DeliveryResult } from '../types.ts';

/**
 * Test/validation-build adapter — the only `DeliveryProvider` any code in this repo runs
 * against today (no real provider is selected, §4). Records every send attempt in memory so
 * tests can assert on exactly what would have gone out, without ever touching a real SMS/
 * email API.
 */
export class MockDeliveryProvider implements DeliveryProvider {
  readonly providerName = 'mock-delivery';
  readonly sent: DeliveryInput[] = [];
  #failFor = new Set<string>();

  /** Test control: the next `send()` to this destination resolves `{accepted: false}` — the
   * mock's equivalent of `MockFinancialProvider`'s scenario controls. */
  simulateFailureFor(destination: string): void {
    this.#failFor.add(destination);
  }

  async send(input: DeliveryInput): Promise<DeliveryResult> {
    this.sent.push(input);
    if (this.#failFor.has(input.destination)) {
      this.#failFor.delete(input.destination);
      return { accepted: false, failureReason: 'MOCK_SIMULATED_FAILURE' };
    }
    return { accepted: true, providerMessageId: `mock_msg_${this.sent.length}` };
  }
}
