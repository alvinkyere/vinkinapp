export type DeliveryMethod = 'EMAIL' | 'SMS';

/**
 * The invitation-template variables Phase 6 §9 names explicitly (`{organizerName}`,
 * `{purpose}`, `{yourShare}`, `{deadline}`, `{link}`) — a provider-neutral input, never a
 * rendered string. Rendering (subject lines, SMS body length limits, HTML vs. plain text) is
 * each adapter's own concern, exactly like `FinancialProvider`'s inputs stay provider-neutral.
 */
export interface InvitationTemplateInput {
  kind: 'guest_invite' | 'member_invite';
  organizerName: string;
  purpose: string;
  yourShareMinor: number;
  /** ISO 8601 — never a raw internal deadline concept (Phase 6 §13's own vocabulary rules
   * apply here too), rendering is the adapter's job. */
  deadline: string;
  /** Present for `guest_invite` (the whole point — a guest has no app to open). Absent for
   * `member_invite`: Phase 6 §9's own member SMS/email templates carry no link at all
   * ("Open the VinkIn app to see it"), a member already has an account. */
  link?: string;
}

/** ENG5 Slice 1 — an account-security transactional message has none of an invitation's
 * fields (no organizer, no purchase, no share, no deadline); a real discriminated union
 * (rather than widening the shared interface with more optional fields) keeps each kind's
 * actual data shape honest. */
export interface EmailVerificationTemplateInput {
  kind: 'email_verification';
  link: string;
}

/** ENG5 Slice 2 — same shape as email verification (just a link), but a distinct `kind` so an
 * adapter can render appropriately different subject/copy for "verify your email" vs. "reset
 * your password" (and, more importantly, so `MockDeliveryProvider`-backed tests can assert on
 * which one was actually sent). */
export interface PasswordResetTemplateInput {
  kind: 'password_reset';
  link: string;
}

/** ENG5 Slice 3 — same shape again, distinct `kind` for the same rendering/assertion reasons
 * as its two siblings. */
export interface MagicLinkTemplateInput {
  kind: 'magic_link';
  link: string;
}

export type DeliveryTemplateInput =
  | InvitationTemplateInput
  | EmailVerificationTemplateInput
  | PasswordResetTemplateInput
  | MagicLinkTemplateInput;

export interface DeliveryInput {
  destination: string;
  method: DeliveryMethod;
  template: DeliveryTemplateInput;
}

export interface DeliveryResult {
  accepted: boolean;
  providerMessageId?: string;
  failureReason?: string;
}
