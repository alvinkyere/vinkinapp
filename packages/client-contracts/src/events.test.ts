import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VINKIN_ANALYTICS_EVENT_NAMES, type VinkinAnalyticsEventName } from './events.ts';
import { EVENT_CONTRACT_SOURCE, allEventNamesCovered } from './traceability.ts';

/** Compile-time exhaustiveness over every declared event name — the same enforcement
 * pattern as `screens.test.ts`'s `assertScreenIdIsKnown`. */
function assertEventNameIsKnown(name: VinkinAnalyticsEventName): void {
  switch (name) {
    case 'welcome_login_tapped':
    case 'welcome_register_tapped':
    case 'login_attempted':
    case 'login_failed':
    case 'registration_attempted':
    case 'registration_failed':
    case 'create_started':
    case 'participant_add_attempted':
    case 'participant_added':
    case 'participant_edited':
    case 'participant_removed':
    case 'vink_open_attempted':
    case 'vink_opened':
    case 'vink_open_failed':
    case 'invitation_dispatch_attempted':
    case 'invitation_delivered':
    case 'invitation_delivery_failed':
    case 'invitation_fallback_opened':
    case 'invitation_resend_attempted':
    case 'invite_link_copied':
    case 'invite_share_sheet_opened':
    case 'invite_qr_shown':
    case 'contribution_attempted':
    case 'contribution_confirmed':
    case 'contribution_declined':
    case 'guest_contribution_attempted':
    case 'guest_contribution_confirmed':
    case 'guest_contribution_declined':
    case 'contribution_retry_attempted':
    case 'vink_cancel_attempted':
    case 'vink_cancelled':
    case 'card_provisioning_started':
    case 'pay_now_entered':
    case 'vink_completed':
    case 'activity_row_opened':
    case 'vink_details_opened':
    case 'contact_info_updated':
    case 'password_change_attempted':
    case 'password_changed':
    case 'support_contact_opened':
    case 'reauth_prompted':
    case 'reauth_succeeded':
    case 'reauth_cancelled':
    case 'offline_detected':
    case 'reconnected':
    case 'generic_error_shown':
      return;
    default: {
      const exhaustive: never = name;
      throw new Error(`unhandled analytics event name: ${String(exhaustive)}`);
    }
  }
}

test('ENG2: every declared event name is exhaustively handled (compile-time check ran)', () => {
  for (const name of VINKIN_ANALYTICS_EVENT_NAMES) assertEventNameIsKnown(name);
});

test('ENG2: the event-name registry has no duplicates', () => {
  assert.equal(new Set(VINKIN_ANALYTICS_EVENT_NAMES).size, VINKIN_ANALYTICS_EVENT_NAMES.length);
});

test('ENG2: every declared event has exactly one traceability entry, and vice versa', () => {
  assert.equal(allEventNamesCovered(), true);
  const sourceKeys = Object.keys(EVENT_CONTRACT_SOURCE).sort();
  const declaredNames = [...VINKIN_ANALYTICS_EVENT_NAMES].sort();
  assert.deepEqual(sourceKeys, declaredNames);
});

test('ENG2: every traceability entry cites at least one real Phase 5 interaction id', () => {
  for (const [name, ids] of Object.entries(EVENT_CONTRACT_SOURCE)) {
    assert.ok(ids.length > 0, `${name} must cite at least one Phase 5 interaction id`);
    for (const id of ids) assert.match(id, /^C\d{1,2}$/, `${name}: "${id}" is not a Cxx id`);
  }
});

test('ENG2: the event-name registry has exactly 46 distinct names (31 of the 45 Phase 5 contracts carry an Analytics line; two name-sharing pairs — C23/C24 sharing 3 names, C17/C19 sharing 1 — mean 31 contracts still produce 46 distinct names, not 31)', () => {
  assert.equal(VINKIN_ANALYTICS_EVENT_NAMES.length, 46);
});
