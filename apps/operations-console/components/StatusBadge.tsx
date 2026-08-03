const LABELS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  OPEN: 'bg-blue-100 text-blue-800',
  SUBMISSIONS_CLOSED: 'bg-amber-100 text-amber-800',
  PROCESSING_GRACE: 'bg-amber-100 text-amber-800',
  FUNDED: 'bg-emerald-100 text-emerald-800',
  EXPIRED: 'bg-red-100 text-red-800',
  CARD_PROVISIONING: 'bg-violet-100 text-violet-800',
  CARD_READY: 'bg-violet-100 text-violet-800',
  FUNDING_REVERSAL: 'bg-red-100 text-red-800',
  PURCHASE_AUTHORIZED: 'bg-violet-100 text-violet-800',
  SETTLING: 'bg-violet-100 text-violet-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  RECOVERY_REQUIRED: 'bg-red-100 text-red-800',
  RECOVERY_PENDING: 'bg-amber-100 text-amber-800',
  CANCELLED: 'bg-gray-100 text-gray-700',
  RESTRICTED: 'bg-red-100 text-red-800',
};

export function StatusBadge({ state }: { state: string }) {
  const className = LABELS[state] ?? 'bg-gray-100 text-gray-700';
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {state}
    </span>
  );
}
