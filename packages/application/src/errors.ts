/**
 * Typed application errors. Transports map `code` to a status; commands never throw raw
 * strings. Domain errors (DomainError/IllegalTransitionError) pass through untouched —
 * they are already typed.
 */

export type ApplicationErrorCode =
  | 'VINK_NOT_FOUND'
  | 'PARTICIPANT_NOT_FOUND'
  | 'FORBIDDEN' // actor is not the organizer of this vink
  | 'VINK_VERSION_CONFLICT' // optimistic concurrency (Plan §11) — HTTP 409
  | 'VINK_NOT_JOINABLE' // guest join on a non-OPEN or past-deadline vink — HTTP 410
  | 'GUEST_UNAUTHENTICATED' // invalid/expired guest token — HTTP 401
  | 'PARTICIPANT_ALREADY_ADDED' // ENG1 #4: this exact user is already a participant — HTTP 409
  | 'INVITE_ALREADY_SENT' // ENG1 #4: this exact invite idempotency key was already used — HTTP 409
  | 'INVALID_COMMAND'; // command-level validation that is not a domain invariant

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;

  constructor(code: ApplicationErrorCode, message: string) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
  }
}

/**
 * Internal signal from a persistence adapter: two concurrent creates raced on the same
 * (organizer, creation idempotency key) pair and this one lost at the database's unique
 * constraint — the final guard, per the hard rule that an application-layer pre-check is
 * only an optimization. `createVinkCommand` catches this and replays the winner rather than
 * surfacing an error; it should never reach a transport layer.
 */
export class CreationIdempotencyRaceError extends Error {
  constructor() {
    super('creation idempotency key already claimed by a concurrent request');
    this.name = 'CreationIdempotencyRaceError';
  }
}

/**
 * Same shape as CreationIdempotencyRaceError, scoped to guest invites: two concurrent
 * `inviteGuestCommand` calls raced on the same (vink, invitation idempotency key) pair.
 * `inviteGuestCommand` catches this and rethrows it as the typed `INVITE_ALREADY_SENT`
 * ApplicationError — there is no data to replay here (D14: the raw guest token is never
 * persisted), only a duplicate to refuse.
 */
export class InviteIdempotencyRaceError extends Error {
  constructor() {
    super('invitation idempotency key already claimed by a concurrent request');
    this.name = 'InviteIdempotencyRaceError';
  }
}
