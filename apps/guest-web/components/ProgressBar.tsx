import { formatMoney } from '../lib/money';

export function ProgressBar({
  fundedAmountMinor,
  requiredAmountMinor,
}: {
  fundedAmountMinor: number;
  requiredAmountMinor: number;
}) {
  const progress = requiredAmountMinor === 0 ? 0 : Math.min(1, fundedAmountMinor / requiredAmountMinor);
  return (
    <div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Funding progress: ${formatMoney(fundedAmountMinor)} of ${formatMoney(requiredAmountMinor)}`}
        className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200"
      >
        <div
          className="h-full rounded-full bg-blue-600 transition-[width] duration-500"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-gray-600">
        {formatMoney(fundedAmountMinor)} of {formatMoney(requiredAmountMinor)} funded
      </p>
    </div>
  );
}
