import type { DeliveryTemplateInput } from '../types.ts';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function formatUsd(amountMinor: number): string {
  return (amountMinor / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

function formatDeadline(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const SUPPORT_FOOTER_TEXT =
  "If you didn't expect this email, you can safely ignore it. VinkIn never asks for your " +
  'card details by email.';

function wrap(bodyHtml: string, isProduction: boolean): string {
  const testBanner = isProduction
    ? ''
    : `<p style="background:#fff3cd;color:#664d03;padding:8px 12px;border-radius:6px;` +
      `font-size:13px;margin:0 0 16px">Test invitation — no production delivery guarantees.</p>`;
  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;` +
    `margin:0 auto;padding:24px;color:#1a1a1a">` +
    `<div style="font-size:20px;font-weight:700;margin-bottom:16px">VinkIn</div>` +
    testBanner +
    bodyHtml +
    `<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0">` +
    `<p style="font-size:12px;color:#6b7280;margin:0">${SUPPORT_FOOTER_TEXT}</p>` +
    `</div>`
  );
}

function ctaButtonHtml(link: string, label: string): string {
  return (
    `<a href="${escapeHtml(link)}" style="display:inline-block;background:#111827;color:#fff;` +
    `padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">` +
    `${escapeHtml(label)}</a>` +
    `<p style="font-size:13px;color:#6b7280;word-break:break-all">Or paste this link into your ` +
    `browser: ${escapeHtml(link)}</p>`
  );
}

/**
 * Renders every `DeliveryTemplateInput` kind (RM4D-C) into a subject/HTML/plain-text triple.
 * Never includes raw payment state, card details, processor references, or reusable auth
 * material beyond the one intended invite/action URL (RM4D-C's own "do not include" list) —
 * every field here is already the provider-neutral, pre-sanitized shape `packages/delivery`'s
 * `DeliveryTemplateInput` union defines.
 */
export function renderEmail(template: DeliveryTemplateInput, isProduction: boolean): RenderedEmail {
  switch (template.kind) {
    case 'guest_invite': {
      const share = formatUsd(template.yourShareMinor);
      const deadline = formatDeadline(template.deadline);
      const subject = `${template.organizerName} invited you to a VinkIn split`;
      const html = wrap(
        `<p>${escapeHtml(template.organizerName)} invited you to join <strong>${escapeHtml(
          template.purpose,
        )}</strong> on VinkIn — a group checkout where everyone pays their own share.</p>` +
          `<p>Your share: <strong>${share}</strong></p>` +
          `<p>Join by: <strong>${deadline}</strong></p>` +
          ctaButtonHtml(template.link ?? '', 'Join this Vink'),
        isProduction,
      );
      const text =
        `${template.organizerName} invited you to join "${template.purpose}" on VinkIn.\n` +
        `Your share: ${share}\nJoin by: ${deadline}\n\nJoin this Vink: ${template.link ?? ''}\n\n` +
        SUPPORT_FOOTER_TEXT;
      return { subject, html, text };
    }
    case 'member_invite': {
      const share = formatUsd(template.yourShareMinor);
      const deadline = formatDeadline(template.deadline);
      const subject = `${template.organizerName} added you to a VinkIn split`;
      const html = wrap(
        `<p>${escapeHtml(template.organizerName)} added you to <strong>${escapeHtml(
          template.purpose,
        )}</strong> on VinkIn.</p>` +
          `<p>Your share: <strong>${share}</strong></p>` +
          `<p>Respond by: <strong>${deadline}</strong></p>` +
          `<p>Open the VinkIn app to see it.</p>`,
        isProduction,
      );
      const text =
        `${template.organizerName} added you to "${template.purpose}" on VinkIn.\n` +
        `Your share: ${share}\nRespond by: ${deadline}\n\nOpen the VinkIn app to see it.\n\n` +
        SUPPORT_FOOTER_TEXT;
      return { subject, html, text };
    }
    case 'email_verification': {
      const subject = 'Verify your VinkIn email';
      const html = wrap(
        `<p>Confirm this is your email address to finish setting up your VinkIn account.</p>` +
          ctaButtonHtml(template.link, 'Verify email'),
        isProduction,
      );
      const text = `Verify your VinkIn email: ${template.link}\n\n${SUPPORT_FOOTER_TEXT}`;
      return { subject, html, text };
    }
    case 'password_reset': {
      const subject = 'Reset your VinkIn password';
      const html = wrap(
        `<p>We received a request to reset your VinkIn password. If this wasn't you, you can ` +
          `ignore this email — your password won't change.</p>` +
          ctaButtonHtml(template.link, 'Reset password'),
        isProduction,
      );
      const text = `Reset your VinkIn password: ${template.link}\n\n${SUPPORT_FOOTER_TEXT}`;
      return { subject, html, text };
    }
    case 'magic_link': {
      const subject = 'Your VinkIn sign-in link';
      const html = wrap(
        `<p>Tap below to sign in to VinkIn. This link is single-use and expires shortly.</p>` +
          ctaButtonHtml(template.link, 'Sign in to VinkIn'),
        isProduction,
      );
      const text = `Sign in to VinkIn: ${template.link}\n\n${SUPPORT_FOOTER_TEXT}`;
      return { subject, html, text };
    }
  }
}
