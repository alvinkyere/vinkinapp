// Mirrors apps/mobile/lib/design_system/components/vink_status_badge.dart's exact D11
// state → human-copy table and tone groups, so a guest sees the identical vocabulary the
// organizer's app uses — no raw backend state name, ever, on either surface.
const LABELS: Record<
  string,
  { label: string; tone: 'neutral' | 'active' | 'positive' | 'attention' }
> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  OPEN: { label: 'Waiting for everyone', tone: 'neutral' },
  SUBMISSIONS_CLOSED: { label: 'Wrapping up', tone: 'active' },
  PROCESSING_GRACE: { label: 'Confirming payments', tone: 'active' },
  FUNDED: { label: "Everyone's in", tone: 'positive' },
  CARD_PROVISIONING: { label: 'Getting your card ready', tone: 'active' },
  CARD_READY: { label: 'Ready to pay', tone: 'positive' },
  FUNDING_REVERSAL: { label: 'Refunding', tone: 'attention' },
  PURCHASE_AUTHORIZED: { label: 'Paying now', tone: 'active' },
  SETTLING: { label: 'Finishing up', tone: 'active' },
  COMPLETED: { label: 'Completed', tone: 'positive' },
  RECOVERY_REQUIRED: { label: 'Resolving a shortfall', tone: 'attention' },
  RECOVERY_PENDING: { label: 'Resolving a shortfall', tone: 'attention' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  RESTRICTED: { label: 'Restricted', tone: 'attention' },
  EXPIRED: { label: 'Expired', tone: 'attention' },
};

// `attention` keeps its danger-tinted background (a non-text use, passes the 3:1 non-text
// threshold on its own) but uses `text-ink`, not `text-danger`, for the label itself:
// danger-on-danger/12 fails WCAG AA at this badge's actual rendered text size (D36;
// docs/design/phase-8-visual-system-refinement.md §4/§24 — bold weight alone doesn't grant
// the large-text exception). Mirrors the identical fix in
// apps/mobile/lib/design_system/components/vink_status_badge.dart.
const TONE_CLASSES: Record<string, string> = {
  neutral: 'bg-ink/8 text-smoke',
  active: 'bg-blue/12 text-blue',
  positive: 'bg-blue text-white',
  attention: 'bg-danger/12 text-ink',
};

export function StatusBadge({ state }: { state: string }) {
  const entry = LABELS[state] ?? { label: state, tone: 'neutral' as const };
  return (
    <span
      role="status"
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold font-sans ${TONE_CLASSES[entry.tone]}`}
    >
      {entry.label}
    </span>
  );
}
