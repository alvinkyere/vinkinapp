/**
 * Typed domain errors (Plan §29.10). Application services branch on `code`;
 * messages are for logs and operators, never for control flow.
 */

export type DomainErrorCode =
  | 'ILLEGAL_TRANSITION' // state machine rejected the event — evidence of a race or a bug, never a no-op
  | 'INVARIANT_VIOLATION'
  | 'INVALID_MONEY'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_SPLIT'
  | 'UNSUPPORTED_SPLIT_METHOD'
  | 'POLICY_VIOLATION'
  | 'UNSUPPORTED_PURCHASE_CATEGORY';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export class IllegalTransitionError extends DomainError {
  readonly aggregate: string;
  readonly from: string;
  readonly event: string;

  constructor(aggregate: string, from: string, event: string) {
    super('ILLEGAL_TRANSITION', `${aggregate}: event ${event} is not legal in state ${from}`);
    this.name = 'IllegalTransitionError';
    this.aggregate = aggregate;
    this.from = from;
    this.event = event;
  }
}

export function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new DomainError('INVARIANT_VIOLATION', message);
}
