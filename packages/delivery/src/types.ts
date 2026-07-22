export type DeliveryMethod = 'EMAIL' | 'SMS';

/**
 * The template variables Phase 6 §9 names explicitly (`{organizerName}`, `{purpose}`,
 * `{yourShare}`, `{deadline}`, `{link}`) — a provider-neutral input, never a rendered
 * string. Rendering (subject lines, SMS body length limits, HTML vs. plain text) is each
 * adapter's own concern, exactly like `FinancialProvider`'s inputs stay provider-neutral.
 */
export interface DeliveryTemplateInput {
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
