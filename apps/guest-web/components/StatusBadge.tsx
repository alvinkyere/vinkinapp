const LABELS: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'Draft', className: 'bg-gray-100 text-gray-700' },
  OPEN: { label: 'Open for contributions', className: 'bg-blue-100 text-blue-800' },
  SUBMISSIONS_CLOSED: { label: 'Submissions closed', className: 'bg-amber-100 text-amber-800' },
  PROCESSING_GRACE: { label: 'Finishing up', className: 'bg-amber-100 text-amber-800' },
  FUNDED: { label: 'Funded', className: 'bg-emerald-100 text-emerald-800' },
  EXPIRED: { label: 'Expired', className: 'bg-red-100 text-red-800' },
  CARD_PROVISIONING: { label: 'Preparing card', className: 'bg-violet-100 text-violet-800' },
  CARD_READY: { label: 'Card ready', className: 'bg-violet-100 text-violet-800' },
  FUNDING_REVERSAL: { label: 'Reversing funds', className: 'bg-red-100 text-red-800' },
  PURCHASE_AUTHORIZED: { label: 'Purchase in progress', className: 'bg-violet-100 text-violet-800' },
  SETTLING: { label: 'Settling', className: 'bg-violet-100 text-violet-800' },
  COMPLETED: { label: 'Completed', className: 'bg-emerald-100 text-emerald-800' },
  RECOVERY_REQUIRED: { label: 'Recovery needed', className: 'bg-red-100 text-red-800' },
  RECOVERY_PENDING: { label: 'Recovery in progress', className: 'bg-amber-100 text-amber-800' },
  CANCELLED: { label: 'Cancelled', className: 'bg-gray-100 text-gray-700' },
  RESTRICTED: { label: 'Restricted', className: 'bg-red-100 text-red-800' },
};

export function StatusBadge({ state }: { state: string }) {
  const entry = LABELS[state] ?? { label: state, className: 'bg-gray-100 text-gray-700' };
  return (
    <span
      role="status"
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium ${entry.className}`}
    >
      {entry.label}
    </span>
  );
}
