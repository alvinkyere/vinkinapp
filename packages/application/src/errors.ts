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
  | 'INVALID_COMMAND'; // command-level validation that is not a domain invariant

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;

  constructor(code: ApplicationErrorCode, message: string) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
  }
}
