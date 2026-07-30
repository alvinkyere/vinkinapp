/**
 * ENG6 Slice 5 — which VinkIn domain concept a given `ProviderEventType` is expected to
 * correlate against. Pure, provider-neutral: every adapter (mock, Stripe, any future one)
 * normalizes into the same `ProviderEventType` union (§43), so this map never needs to know
 * which provider produced the event.
 */

import type { ProviderEventType } from '../../payment-provider/src/index.ts';
import type { CorrelationTargetKind } from './types.ts';

export function correlationTargetFor(eventType: ProviderEventType): CorrelationTargetKind {
  switch (eventType) {
    case 'payment.authorized':
    case 'payment.captured':
    case 'payment.canceled':
    case 'payment.authorization.expired':
    case 'payment.declined':
    case 'refund.completed':
      // All contribution-side events correlate against `contributions.provider_reference`,
      // which is set once to the provider's own payment id. Refunds are confirmed (mock and
      // Stripe both) to reuse the SAME payment/objectId, not a distinct refund object id —
      // VinkIn's own domain models a refund as a state on the contribution, not a separate
      // entity, so this is the correct, not merely convenient, correlation target.
      return 'contribution';
    case 'card.authorization.request':
    case 'card.authorization.created':
      return 'purchase_authorization';
    case 'card.capture.created':
      // VinkIn's `settlements` table has no direct provider-object column — correlation is a
      // two-hop lookup (providerCardId -> temporary_cards OR cards/card_assignments (RM3B,
      // D47) -> vink_id -> settlements), handled in apps/api's ReconciliationStore, not here
      // (this map only names the TARGET kind).
      return 'settlement';
    case 'dispute.created':
      // VinkIn's domain models no disputes anywhere today (confirmed by search before writing
      // this) — always UNRECOGNIZED, honestly, not silently dropped or guessed at.
      return 'none';
  }
}
