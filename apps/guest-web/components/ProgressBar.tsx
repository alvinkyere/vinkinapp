import { formatMoney } from '../lib/money';

// The exact bar from vinkin.org's own product-preview card, same as the Flutter app's
// VinkProgressIndicator: h-3 ink/10 track, plain blue fill, no liquid/droplet animation —
// the ink metaphor stays in the logo and copy, not the product's own progress UI.
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
        className="h-3 w-full overflow-hidden rounded-full bg-ink/10"
      >
        <div
          className="h-full rounded-full bg-blue transition-[width] duration-500"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-smoke font-sans">
        {formatMoney(fundedAmountMinor)} of {formatMoney(requiredAmountMinor)} funded
      </p>
    </div>
  );
}
