const CLASSIFICATION_STYLES: Record<string, string> = {
  EXPECTED: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800',
  MISMATCHED: 'bg-red-100 text-red-800',
  ORPHANED: 'bg-orange-100 text-orange-800',
  UNRECOGNIZED: 'bg-gray-100 text-gray-700',
};

export function ClassificationBadge({ classification }: { classification: string }) {
  const className = CLASSIFICATION_STYLES[classification] ?? 'bg-gray-100 text-gray-700';
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {classification}
    </span>
  );
}

const REVIEW_STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-blue-100 text-blue-800',
  ACKNOWLEDGED: 'bg-amber-100 text-amber-800',
  RESOLVED: 'bg-emerald-100 text-emerald-800',
};

export function ReviewStatusBadge({ reviewStatus }: { reviewStatus: string }) {
  const className = REVIEW_STATUS_STYLES[reviewStatus] ?? 'bg-gray-100 text-gray-700';
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {reviewStatus}
    </span>
  );
}

const WEBHOOK_STATUS_STYLES: Record<string, string> = {
  received: 'bg-emerald-100 text-emerald-800',
  dead_letter: 'bg-red-100 text-red-800',
};

export function WebhookStatusBadge({ status }: { status: string }) {
  const className = WEBHOOK_STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700';
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {status === 'dead_letter' ? 'DEAD LETTER' : status.toUpperCase()}
    </span>
  );
}
