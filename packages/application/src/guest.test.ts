import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { UserId } from '../../domain/src/index.ts';
import { InMemoryVinkStore } from './testing/in-memory.ts';
import { ApplicationError } from './errors.ts';
import type { CommandContext, PublicCommandContext } from './ports.ts';
import {
  addParticipantCommand,
  createVinkCommand,
  openVinkCommand,
  setSplitCommand,
} from './commands.ts';
import {
  editGuestParticipantCommand,
  getGuestVinkView,
  getPublicVinkView,
  guestJoinVinkCommand,
  inviteGuestCommand,
  resendGuestInvitationCommand,
} from './guest.ts';

const ORGANIZER = 'organizer-user' as UserId;
const NOW = new Date('2026-07-18T10:00:00Z');
const DEADLINE = '2026-07-18T12:00:00Z';

function ctx(store: InMemoryVinkStore): CommandContext {
  return { uow: store, clock: { now: () => NOW }, actorUserId: ORGANIZER, correlationId: 'test' };
}

function publicCtx(store: InMemoryVinkStore, now: Date = NOW): PublicCommandContext {
  return { uow: store, clock: { now: () => now }, correlationId: 'test' };
}

const isAppError = (code: string) => (error: unknown) =>
  error instanceof ApplicationError && error.code === code;

async function openVink(store: InMemoryVinkStore) {
  const { vink } = await createVinkCommand(ctx(store), {
    purchaseCategory: 'GROCERY',
    subtotalMinor: 12_000,
    tipMinor: 0,
    submissionDeadline: DEADLINE,
    organizerDisplayName: 'Org',
  });
  await addParticipantCommand(ctx(store), {
    vinkId: vink.id,
    userId: 'member-1' as UserId,
    displayName: 'member',
  });
  await setSplitCommand(ctx(store), { vinkId: vink.id, method: 'EQUAL' });
  return openVinkCommand(ctx(store), { vinkId: vink.id });
}

describe('guest join (Plan PV4, journey E9)', () => {
  it('a guest joins an OPEN vink and can see their own view via the token hash', async () => {
    const store = new InMemoryVinkStore();
    const vink = await openVink(store);

    const joined = await guestJoinVinkCommand(publicCtx(store), {
      publicCode: vink.publicCode,
      displayName: 'Walk-up Guest',
      accessTokenHash: 'hash-guest-1',
    });
    assert.equal(joined.participant.role, 'MEMBER');
    assert.equal(joined.participant.userId, null);
    assert.equal(joined.participant.guestIdentityId, joined.guest.id);
    assert.equal(joined.vink.participantCount, 3);
    assert.equal(store.outbox.at(-1)?.eventType, 'ParticipantJoined');
    assert.equal(store.outbox.at(-1)?.payload.guest, true);

    const view = await getGuestVinkView(store, 'hash-guest-1', NOW);
    assert.equal(view.participant.displayName, 'Walk-up Guest');
    assert.equal(view.participant.allocatedAmountMinor, 0);
    assert.equal(view.vink.publicCode, vink.publicCode);
  });

  it('rejects joins on DRAFT and past-deadline vinks with VINK_NOT_JOINABLE', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createVinkCommand(ctx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 1_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    await assert.rejects(
      guestJoinVinkCommand(publicCtx(store), {
        publicCode: vink.publicCode,
        displayName: 'Early Guest',
        accessTokenHash: 'h1',
      }),
      isAppError('VINK_NOT_JOINABLE'),
    );

    const opened = await openVink(store);
    const afterDeadline = new Date('2026-07-18T12:00:01Z');
    await assert.rejects(
      guestJoinVinkCommand(publicCtx(store, afterDeadline), {
        publicCode: opened.publicCode,
        displayName: 'Late Guest',
        accessTokenHash: 'h2',
      }),
      isAppError('VINK_NOT_JOINABLE'),
    );
    await assert.rejects(
      guestJoinVinkCommand(publicCtx(store), {
        publicCode: 'NOSUCHCODE',
        displayName: 'Lost Guest',
        accessTokenHash: 'h3',
      }),
      isAppError('VINK_NOT_FOUND'),
    );
  });

  it('public view reports joinable truthfully and counts active participants', async () => {
    const store = new InMemoryVinkStore();
    const vink = await openVink(store);
    const view = await getPublicVinkView(store, vink.publicCode, NOW);
    assert.equal(view.joinable, true);
    assert.equal(view.participantCount, 2);
    assert.equal(view.requiredAmountMinor, 12_000);

    const late = await getPublicVinkView(store, vink.publicCode, new Date('2026-07-19T00:00:00Z'));
    assert.equal(late.joinable, false);
  });

  it('an expired guest token no longer resolves', async () => {
    const store = new InMemoryVinkStore();
    const vink = await openVink(store);
    await guestJoinVinkCommand(publicCtx(store), {
      publicCode: vink.publicCode,
      displayName: 'Guest',
      accessTokenHash: 'expiring-hash',
    });
    const eightDaysLater = new Date('2026-07-26T10:00:01Z');
    await assert.rejects(
      getGuestVinkView(store, 'expiring-hash', eightDaysLater),
      isAppError('GUEST_UNAUTHENTICATED'),
    );
    await assert.rejects(
      getGuestVinkView(store, 'unknown-hash', NOW),
      isAppError('GUEST_UNAUTHENTICATED'),
    );
  });
});

describe('organizer invite-guest (ENG1 #4: idempotent invites)', () => {
  async function draftVink(store: InMemoryVinkStore) {
    const { vink } = await createVinkCommand(ctx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 12_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    return vink;
  }

  it('invites a guest, emitting ParticipantJoined', async () => {
    const store = new InMemoryVinkStore();
    const vink = await draftVink(store);
    const result = await inviteGuestCommand(ctx(store), {
      vinkId: vink.id,
      displayName: 'Dinner Guest',
      deliveryMode: 'MANUAL',
      accessTokenHash: 'hash-1',
    });
    assert.equal(result.participant.displayName, 'Dinner Guest');
    assert.equal(result.participant.guestIdentityId, result.guest.id);
    assert.equal(store.outbox.at(-1)?.eventType, 'ParticipantJoined');
    assert.equal(store.outbox.at(-1)?.payload.invitedByOrganizer, true);
  });

  it('a repeated invitationIdempotencyKey is rejected, not duplicated', async () => {
    const store = new InMemoryVinkStore();
    const vink = await draftVink(store);
    const input = {
      vinkId: vink.id,
      displayName: 'Dinner Guest',
      deliveryMode: 'MANUAL' as const,
      accessTokenHash: 'hash-1',
      invitationIdempotencyKey: 'attempt-1',
    };
    const first = await inviteGuestCommand(ctx(store), input);

    // The client never saw `first`'s response (the raw guest token/link is gone by design —
    // D14 — so there is nothing to replay) and retries with the SAME key.
    await assert.rejects(
      inviteGuestCommand(ctx(store), { ...input, accessTokenHash: 'hash-2' }),
      isAppError('INVITE_ALREADY_SENT'),
    );

    const participants = await store.listParticipants(vink.id);
    assert.equal(
      participants.filter((p) => p.displayName === 'Dinner Guest').length,
      1,
      'only one guest participant exists for this idempotency key',
    );
    assert.equal(first.participant.status, 'JOINED');
  });

  it('a different key (or omitting it) is a genuinely new invite', async () => {
    const store = new InMemoryVinkStore();
    const vink = await draftVink(store);
    await inviteGuestCommand(ctx(store), {
      vinkId: vink.id,
      displayName: 'Guest A',
      deliveryMode: 'MANUAL',
      accessTokenHash: 'hash-a',
      invitationIdempotencyKey: 'key-a',
    });
    await inviteGuestCommand(ctx(store), {
      vinkId: vink.id,
      displayName: 'Guest B',
      deliveryMode: 'MANUAL',
      accessTokenHash: 'hash-b',
      invitationIdempotencyKey: 'key-b',
    });
    // Omitting the key entirely forgoes protection (back-compat) — still two distinct guests.
    await inviteGuestCommand(ctx(store), {
      vinkId: vink.id,
      displayName: 'Guest C',
      deliveryMode: 'MANUAL',
      accessTokenHash: 'hash-c',
    });
    const participants = await store.listParticipants(vink.id);
    assert.equal(participants.filter((p) => p.role === 'MEMBER').length, 3);
  });

  it('a lost race at the store is rejected as already-sent, not thrown as an error', async () => {
    const store = new InMemoryVinkStore();
    const vink = await draftVink(store);
    const input = {
      vinkId: vink.id,
      displayName: 'Dinner Guest',
      deliveryMode: 'MANUAL' as const,
      accessTokenHash: 'hash-1',
      invitationIdempotencyKey: 'contested-key',
    };
    await inviteGuestCommand(ctx(store), input);

    // Simulate the rarer genuine race: this transaction's own pre-check ran before the
    // concurrent winner's commit was visible to it, so it proceeded to record the key and
    // only then discovered — via the unique constraint, not the pre-check — that it lost.
    const originalFind = store.findGuestInviteIdempotencyKey.bind(store);
    let findCalls = 0;
    store.findGuestInviteIdempotencyKey = async (vinkId, key) => {
      findCalls += 1;
      return findCalls === 1 ? false : originalFind(vinkId, key);
    };

    // Note: this only proves the race is DETECTED and rejected, not full atomicity —
    // InMemoryVinkStore is explicitly not transactional (see its own doc comment), so a
    // phantom participant row from the losing attempt isn't rolled back here the way the
    // real Postgres adapter rolls back its whole transaction on any thrown error. The
    // "exactly one guest, even under a real race" guarantee is proven for real against real
    // Postgres by `apps/api/src/vinks.integration.test.ts`'s equivalent test.
    await assert.rejects(
      inviteGuestCommand(ctx(store), { ...input, accessTokenHash: 'hash-2' }),
      isAppError('INVITE_ALREADY_SENT'),
    );
  });
});

describe('guest delivery-mode contract (Slice I4B, D38)', () => {
  async function draftVink(store: InMemoryVinkStore) {
    const { vink } = await createVinkCommand(ctx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 12_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    return vink;
  }

  it('SMS mode requires a contact destination and mints no token here', async () => {
    const store = new InMemoryVinkStore();
    const vink = await draftVink(store);
    await assert.rejects(
      inviteGuestCommand(ctx(store), {
        vinkId: vink.id,
        displayName: 'Phone Guest',
        deliveryMode: 'SMS',
      }),
      isAppError('INVALID_COMMAND'),
    );
    const result = await inviteGuestCommand(ctx(store), {
      vinkId: vink.id,
      displayName: 'Phone Guest',
      deliveryMode: 'SMS',
      contactDestination: '+15551234567',
    });
    assert.equal(result.guest.accessTokenHash, null, 'no token minted at invite time');
    assert.equal(result.guest.expiresAt, null);
    assert.equal(result.guest.deliveryMode, 'SMS');
    assert.equal(result.guest.contactMethod, 'SMS');
  });

  it('EMAIL mode requires a contact destination and mints no token here', async () => {
    const store = new InMemoryVinkStore();
    const vink = await draftVink(store);
    await assert.rejects(
      inviteGuestCommand(ctx(store), {
        vinkId: vink.id,
        displayName: 'Email Guest',
        deliveryMode: 'EMAIL',
      }),
      isAppError('INVALID_COMMAND'),
    );
    const result = await inviteGuestCommand(ctx(store), {
      vinkId: vink.id,
      displayName: 'Email Guest',
      deliveryMode: 'EMAIL',
      contactDestination: 'guest@example.com',
    });
    assert.equal(result.guest.accessTokenHash, null);
    assert.equal(result.guest.deliveryMode, 'EMAIL');
    assert.equal(result.guest.contactMethod, 'EMAIL');
  });

  it('MANUAL mode requires a pre-minted token and rejects a contact destination', async () => {
    const store = new InMemoryVinkStore();
    const vink = await draftVink(store);
    await assert.rejects(
      inviteGuestCommand(ctx(store), {
        vinkId: vink.id,
        displayName: 'Manual Guest',
        deliveryMode: 'MANUAL',
      }),
      isAppError('INVALID_COMMAND'),
      'manual mode still requires the transport to have pre-minted a token',
    );
    await assert.rejects(
      inviteGuestCommand(ctx(store), {
        vinkId: vink.id,
        displayName: 'Manual Guest',
        deliveryMode: 'MANUAL',
        accessTokenHash: 'hash-manual',
        contactDestination: 'should-not-be-here@example.com',
      }),
      isAppError('INVALID_COMMAND'),
      'manual mode must never carry a destination it will never automatically use',
    );
    const result = await inviteGuestCommand(ctx(store), {
      vinkId: vink.id,
      displayName: 'Manual Guest',
      deliveryMode: 'MANUAL',
      accessTokenHash: 'hash-manual',
    });
    assert.equal(result.guest.accessTokenHash, 'hash-manual');
    assert.equal(result.guest.contactMethod, null);
  });

  it('rejects a pre-minted token for SMS/EMAIL mode (dispatch-time-only minting)', async () => {
    const store = new InMemoryVinkStore();
    const vink = await draftVink(store);
    await assert.rejects(
      inviteGuestCommand(ctx(store), {
        vinkId: vink.id,
        displayName: 'Phone Guest',
        deliveryMode: 'SMS',
        accessTokenHash: 'should-not-be-set',
        contactDestination: '+15551234567',
      }),
      isAppError('INVALID_COMMAND'),
    );
  });

  it('an invite result carries the vink so the transport can decide whether to dispatch now', async () => {
    const store = new InMemoryVinkStore();
    const vink = await draftVink(store);
    const result = await inviteGuestCommand(ctx(store), {
      vinkId: vink.id,
      displayName: 'Phone Guest',
      deliveryMode: 'SMS',
      contactDestination: '+15551234567',
    });
    assert.equal(result.vink.state, 'DRAFT');
  });
});

describe('resendGuestInvitationCommand (Slice I4B, D38)', () => {
  async function openVinkWithGuest(store: InMemoryVinkStore, mode: 'SMS' | 'EMAIL' | 'MANUAL') {
    const { vink } = await createVinkCommand(ctx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 12_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    await addParticipantCommand(ctx(store), {
      vinkId: vink.id,
      userId: 'member-1' as UserId,
      displayName: 'member',
    });
    const invite = await inviteGuestCommand(ctx(store), {
      vinkId: vink.id,
      displayName: 'Guest',
      deliveryMode: mode,
      ...(mode === 'MANUAL'
        ? { accessTokenHash: 'initial-manual-hash' }
        : { contactDestination: mode === 'SMS' ? '+15551234567' : 'guest@example.com' }),
    });
    await setSplitCommand(ctx(store), { vinkId: vink.id, method: 'EQUAL' });
    const opened = await openVinkCommand(ctx(store), { vinkId: vink.id });
    return { vink: opened, participant: invite.participant, guest: invite.guest };
  }

  it('mints a fresh token for an SMS-mode guest, invalidating any prior one', async () => {
    const store = new InMemoryVinkStore();
    const { vink, participant, guest } = await openVinkWithGuest(store, 'SMS');
    // Simulate an earlier successful dispatch already having claimed a slot.
    await store.claimGuestDeliveryToken(guest.id, 'first-dispatch-hash', '2026-07-25T10:00:00Z');

    const resent = await resendGuestInvitationCommand(ctx(store), {
      vinkId: vink.id,
      participantId: participant.id,
      tokenHash: 'second-dispatch-hash',
      expiresAt: '2026-07-25T10:00:00Z',
    });
    assert.equal(resent.guest.accessTokenHash, 'second-dispatch-hash');

    const stored = await store.getGuestIdentity(guest.id);
    assert.equal(stored?.accessTokenHash, 'second-dispatch-hash', 'the old hash no longer exists');
  });

  it('rejects resend for a MANUAL-mode guest', async () => {
    const store = new InMemoryVinkStore();
    const { vink, participant } = await openVinkWithGuest(store, 'MANUAL');
    await assert.rejects(
      resendGuestInvitationCommand(ctx(store), {
        vinkId: vink.id,
        participantId: participant.id,
        tokenHash: 'new-hash',
        expiresAt: '2026-07-25T10:00:00Z',
      }),
      isAppError('INVALID_COMMAND'),
    );
  });

  it('rejects resend before the vink is open', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createVinkCommand(ctx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 12_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    const invite = await inviteGuestCommand(ctx(store), {
      vinkId: vink.id,
      displayName: 'Guest',
      deliveryMode: 'SMS',
      contactDestination: '+15551234567',
    });
    await assert.rejects(
      resendGuestInvitationCommand(ctx(store), {
        vinkId: vink.id,
        participantId: invite.participant.id,
        tokenHash: 'new-hash',
        expiresAt: '2026-07-25T10:00:00Z',
      }),
      isAppError('INVALID_COMMAND'),
    );
  });
});

describe('purpose is available to downstream consumer projections (Slice I5B, D39)', () => {
  it('getPublicVinkView carries the real purpose when the vink has one', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createVinkCommand(ctx(store), {
      purchaseCategory: 'GROCERY',
      purpose: 'Team lunch',
      subtotalMinor: 12_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    const view = await getPublicVinkView(store, vink.publicCode, NOW);
    assert.equal(view.purpose, 'Team lunch');
  });

  it('getPublicVinkView carries null, not an invented value, for a purpose-less (old-flow-shaped) vink', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createVinkCommand(ctx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 12_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    const view = await getPublicVinkView(store, vink.publicCode, NOW);
    assert.equal(view.purpose, null);
  });
});

describe('editGuestParticipantCommand — draft-only guest correction (Slice I5B, D40)', () => {
  async function draftVinkWithSmsGuest(store: InMemoryVinkStore) {
    const { vink } = await createVinkCommand(ctx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 12_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    const invited = await inviteGuestCommand(ctx(store), {
      vinkId: vink.id,
      displayName: 'Original Name',
      deliveryMode: 'SMS',
      contactDestination: '+15551234567',
    });
    return { vink, participant: invited.participant, guest: invited.guest };
  }

  it('edits the guest display name only, leaving delivery mode/destination untouched', async () => {
    const store = new InMemoryVinkStore();
    const { vink, participant } = await draftVinkWithSmsGuest(store);
    const result = await editGuestParticipantCommand(ctx(store), {
      vinkId: vink.id,
      participantId: participant.id,
      displayName: 'Renamed Guest',
      deliveryMode: 'SMS',
      contactDestination: '+15551234567',
    });
    assert.equal(result.participant.displayName, 'Renamed Guest');
    assert.equal(result.guest.displayName, 'Renamed Guest');
    assert.equal(result.guest.deliveryMode, 'SMS');
    assert.equal(result.guest.contactDestination, '+15551234567');
    assert.equal(result.mintedNewManualToken, false);
  });

  it('edits the SMS destination', async () => {
    const store = new InMemoryVinkStore();
    const { vink, participant } = await draftVinkWithSmsGuest(store);
    const result = await editGuestParticipantCommand(ctx(store), {
      vinkId: vink.id,
      participantId: participant.id,
      displayName: 'Original Name',
      deliveryMode: 'SMS',
      contactDestination: '+15559999999',
    });
    assert.equal(result.guest.contactDestination, '+15559999999');
    assert.equal(result.guest.contactMethod, 'SMS');
  });

  it('edits to an email destination and changes delivery mode SMS -> EMAIL, no token involved either side', async () => {
    const store = new InMemoryVinkStore();
    const { vink, participant } = await draftVinkWithSmsGuest(store);
    const result = await editGuestParticipantCommand(ctx(store), {
      vinkId: vink.id,
      participantId: participant.id,
      displayName: 'Original Name',
      deliveryMode: 'EMAIL',
      contactDestination: 'guest@example.com',
    });
    assert.equal(result.guest.deliveryMode, 'EMAIL');
    assert.equal(result.guest.contactMethod, 'EMAIL');
    assert.equal(result.guest.contactDestination, 'guest@example.com');
    assert.equal(
      result.guest.accessTokenHash,
      null,
      'sms/email mode never has a token pre-VINK_OPENED',
    );
  });

  it('rejects an invalid edited destination (empty) for SMS/EMAIL modes', async () => {
    const store = new InMemoryVinkStore();
    const { vink, participant } = await draftVinkWithSmsGuest(store);
    await assert.rejects(
      editGuestParticipantCommand(ctx(store), {
        vinkId: vink.id,
        participantId: participant.id,
        displayName: 'Original Name',
        deliveryMode: 'EMAIL',
        // contactDestination omitted — invalid for EMAIL mode.
      }),
      isAppError('INVALID_COMMAND'),
    );
  });

  it('changing mode SMS -> MANUAL mints a fresh token (transport-supplied hash)', async () => {
    const store = new InMemoryVinkStore();
    const { vink, participant } = await draftVinkWithSmsGuest(store);
    const result = await editGuestParticipantCommand(ctx(store), {
      vinkId: vink.id,
      participantId: participant.id,
      displayName: 'Original Name',
      deliveryMode: 'MANUAL',
      mintedAccessTokenHash: 'freshly-minted-hash',
    });
    assert.equal(result.mintedNewManualToken, true);
    assert.equal(result.guest.accessTokenHash, 'freshly-minted-hash');
    assert.equal(result.guest.contactDestination, null, 'manual mode never carries a destination');
    assert.notEqual(result.guest.expiresAt, null);
  });

  it('changing mode MANUAL -> SMS clears the existing manual token — it can no longer authenticate', async () => {
    const store = new InMemoryVinkStore();
    const { vink } = await createVinkCommand(ctx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 12_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    const invited = await inviteGuestCommand(ctx(store), {
      vinkId: vink.id,
      displayName: 'Manual Guest',
      deliveryMode: 'MANUAL',
      accessTokenHash: 'original-manual-hash',
    });
    const result = await editGuestParticipantCommand(ctx(store), {
      vinkId: vink.id,
      participantId: invited.participant.id,
      displayName: 'Manual Guest',
      deliveryMode: 'SMS',
      contactDestination: '+15551234567',
    });
    assert.equal(result.guest.accessTokenHash, null);
    await assert.rejects(
      getGuestVinkView(store, 'original-manual-hash', NOW),
      isAppError('GUEST_UNAUTHENTICATED'),
    );
  });

  it('rejects editing once the vink is OPEN — draft-only', async () => {
    const store = new InMemoryVinkStore();
    const { vink, participant } = await draftVinkWithSmsGuest(store);
    await addParticipantCommand(ctx(store), {
      vinkId: vink.id,
      userId: 'member-1' as UserId,
      displayName: 'member',
    });
    await setSplitCommand(ctx(store), { vinkId: vink.id, method: 'EQUAL' });
    await openVinkCommand(ctx(store), { vinkId: vink.id });
    await assert.rejects(
      editGuestParticipantCommand(ctx(store), {
        vinkId: vink.id,
        participantId: participant.id,
        displayName: 'Too Late',
        deliveryMode: 'SMS',
        contactDestination: '+15551234567',
      }),
      isAppError('INVALID_COMMAND'),
    );
  });

  it('rejects editing a non-guest (organizer/member) participant', async () => {
    const store = new InMemoryVinkStore();
    const { vink, participants } = await createVinkCommand(ctx(store), {
      purchaseCategory: 'GROCERY',
      subtotalMinor: 12_000,
      tipMinor: 0,
      submissionDeadline: DEADLINE,
      organizerDisplayName: 'Org',
    });
    const organizer = participants[0]!;
    await assert.rejects(
      editGuestParticipantCommand(ctx(store), {
        vinkId: vink.id,
        participantId: organizer.id,
        displayName: 'Nope',
        deliveryMode: 'MANUAL',
        mintedAccessTokenHash: 'irrelevant',
      }),
      isAppError('PARTICIPANT_NOT_FOUND'),
    );
  });
});
