/**
 * ENG2 contract test: every payload shape declared in `@vinkin/client-contracts`'s
 * `VinkinAnalyticsEvent` union must be accepted by the REAL wire schema this API enforces
 * (`batchSchema`/`eventSchema`, `modules/analytics/routes.ts`) — not a hand-mirrored copy of
 * it. One representative literal per distinct payload shape (empty, `{code}`,
 * `{participantId}`, `{count}`, `{role}`, `{reason}`, `{source}`, `{context}`) is enough to
 * prove structural compatibility; this is not attempting to enumerate all 45 event names.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newParticipantId, newVinkId } from '../../../packages/domain/src/index.ts';
import type {
  VinkinAnalyticsBatchRequest,
  VinkinAnalyticsEvent,
} from '../../../packages/client-contracts/src/index.ts';
import { batchSchema } from './modules/analytics/routes.ts';

function batchOf(events: readonly VinkinAnalyticsEvent[]): VinkinAnalyticsBatchRequest {
  return { clientId: 'test-client', app: 'organizer_mobile', events };
}

test('ENG2: every distinct client-contract event payload shape parses against the real analytics wire schema', () => {
  const occurredAt = new Date().toISOString();
  const vinkId = newVinkId();
  const participantId = newParticipantId();

  const samples: VinkinAnalyticsEvent[] = [
    { eventName: 'welcome_login_tapped', properties: {}, occurredAt },
    { eventName: 'login_failed', properties: { code: 'INVALID_CREDENTIALS' }, occurredAt },
    {
      eventName: 'invitation_delivered',
      vinkId,
      properties: { participantId },
      occurredAt,
    },
    { eventName: 'invitation_dispatch_attempted', vinkId, properties: { count: 3 }, occurredAt },
    { eventName: 'participant_added', vinkId, properties: { role: 'guest' }, occurredAt },
    {
      eventName: 'invitation_fallback_opened',
      vinkId,
      properties: { participantId, reason: 'manual' },
      occurredAt,
    },
    {
      eventName: 'support_contact_opened',
      properties: { source: 'vink_details' },
      occurredAt,
    },
    { eventName: 'generic_error_shown', properties: { context: 'lobby_load' }, occurredAt },
  ];

  const result = batchSchema.safeParse(batchOf(samples));
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues));
});

test('ENG2: the envelope-level vinkId is a real UUID the wire schema accepts, never smuggled into properties twice', () => {
  const occurredAt = new Date().toISOString();
  const vinkId = newVinkId();
  const event: VinkinAnalyticsEvent = {
    eventName: 'vink_opened',
    vinkId,
    properties: {},
    occurredAt,
  };
  const parsed = batchSchema.parse(batchOf([event]));
  assert.equal(parsed.events[0]?.vinkId, vinkId);
  assert.deepEqual(parsed.events[0]?.properties, {});
});
