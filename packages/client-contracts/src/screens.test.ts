import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  GuestVinkViewResult,
  NotOpenYetView,
  ParticipantVinkView,
  VinkSnapshot,
} from '../../application/src/index.ts';
import { SCREEN_CONTRACT_IDS, type ScreenContractId } from './screens.ts';
import type {
  GuestNotOpenYetViewModel,
  GuestSessionViewModel,
  LobbyScreenViewModel,
  ParticipantSessionViewModel,
} from './screens.ts';
import { SCREEN_CONTRACT_SOURCE, allScreenContractIdsCovered } from './traceability.ts';
import type { Equal, Expect } from './type-test-utils.ts';

// ---------------------------------------------------------------------------
// Compile-time contract tests (tsc --noEmit is the enforcement — see type-test-utils.ts).
// Each `export type _...` below fails `pnpm --filter @vinkin/client-contracts typecheck` if
// the corresponding screen contract ever silently drifts from the real application-layer
// type it claims to reuse.
// ---------------------------------------------------------------------------

export type _LobbyMatchesVinkSnapshot = Expect<Equal<LobbyScreenViewModel, VinkSnapshot>>;
export type _GuestSessionMatchesGuestVinkViewResult = Expect<
  Equal<GuestSessionViewModel, GuestVinkViewResult>
>;
export type _GuestNotOpenYetMatchesNotOpenYetView = Expect<
  Equal<GuestNotOpenYetViewModel, NotOpenYetView>
>;
export type _ParticipantSessionMatchesParticipantVinkView = Expect<
  Equal<ParticipantSessionViewModel, ParticipantVinkView>
>;

/** Compile-time exhaustiveness: every `ScreenContractId` must be handled — adding a new id
 * to `SCREEN_CONTRACT_IDS` without adding a `case` here fails `tsc --noEmit` at the `never`
 * assignment, forcing `traceability.ts`'s source map to be updated in the same change. */
function assertScreenIdIsKnown(id: ScreenContractId): void {
  switch (id) {
    case 'welcome':
    case 'login':
    case 'register':
    case 'home':
    case 'create_purpose_and_total':
    case 'create_people_and_split':
    case 'open_vink_confirmation':
    case 'lobby':
    case 'guest_not_open_yet':
    case 'guest_join_form':
    case 'guest_session':
    case 'participant_session':
    case 'activity_list':
    case 'activity_vink_details':
    case 'profile':
    case 'guest_token_redeem':
    case 'reauth_overlay':
      return;
    default: {
      const exhaustive: never = id;
      throw new Error(`unhandled screen contract id: ${String(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Runtime contract tests
// ---------------------------------------------------------------------------

test('ENG2: every screen contract id is exhaustively handled (compile-time check ran)', () => {
  for (const id of SCREEN_CONTRACT_IDS) assertScreenIdIsKnown(id);
});

test('ENG2: every screen contract id has exactly one traceability entry, and vice versa', () => {
  assert.equal(allScreenContractIdsCovered(), true);
  const sourceKeys = Object.keys(SCREEN_CONTRACT_SOURCE).sort();
  const declaredIds = [...SCREEN_CONTRACT_IDS].sort();
  assert.deepEqual(sourceKeys, declaredIds);
});

test('ENG2: every traceability entry cites Phase 4 by name, never an uncited invention', () => {
  for (const [id, source] of Object.entries(SCREEN_CONTRACT_SOURCE)) {
    assert.match(source, /^Phase 4 §/, `${id}'s traceability entry must cite a Phase 4 section`);
  }
});

test('ENG2: the canonical screen list has exactly 17 entries (Phase 4 §1-4, §5a-c, §6-14, plus the §6 member branch)', () => {
  assert.equal(SCREEN_CONTRACT_IDS.length, 17);
});
