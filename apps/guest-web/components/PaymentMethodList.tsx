'use client';

import type { PaymentMethodOption, PaymentMethodType } from '../lib/types';

const METHOD_ICON: Record<PaymentMethodType, string> = {
  card: 'Card',
  apple_pay: '',
  venmo: 'V',
  cash_app_pay: '$',
};

/**
 * RM4C-B/F — the required invariant, rendered: a method is either genuinely selectable
 * (`available`) or shown disabled with truthful, specific copy — never a button that leads
 * nowhere with no explanation, never a fabricated success. Availability comes from the
 * server (`GET /api/v1/payment-methods`) — this component never guesses.
 */
export function PaymentMethodList({
  methods,
  selected,
  onSelect,
}: {
  methods: PaymentMethodOption[];
  selected: PaymentMethodType | null;
  onSelect: (type: PaymentMethodType) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Choose how to pay" className="flex flex-col gap-2">
      {methods.map((method) => {
        const isAvailable = method.availability === 'available';
        const isSelected = selected === method.type;
        return (
          <button
            key={method.type}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={!isAvailable}
            onClick={() => isAvailable && onSelect(method.type)}
            className={`flex w-full items-center justify-between rounded-2xl border px-5 py-4 text-left transition ${
              isSelected
                ? 'border-blue bg-blue/5'
                : isAvailable
                  ? 'border-black/10 bg-white hover:border-blue/40'
                  : 'border-black/5 bg-black/[0.02] opacity-60'
            } ${isAvailable ? 'cursor-pointer' : 'cursor-not-allowed'}`}
          >
            <span className="flex items-center gap-3">
              <span aria-hidden="true" className="text-lg">
                {METHOD_ICON[method.type]}
              </span>
              <span>
                <span className="block font-display text-sm font-bold text-ink">
                  {method.displayName}
                </span>
                {!isAvailable && method.unavailableReason !== undefined ? (
                  <span className="mt-0.5 block text-xs text-smoke">
                    {method.unavailableReason}
                  </span>
                ) : null}
              </span>
            </span>
            {isAvailable ? (
              <span
                aria-hidden="true"
                className={`h-5 w-5 shrink-0 rounded-full border-2 ${
                  isSelected ? 'border-blue bg-blue' : 'border-black/20'
                }`}
              />
            ) : (
              <span className="shrink-0 rounded-full bg-black/5 px-2.5 py-1 text-[10px] font-bold tracking-wide text-smoke uppercase">
                {method.availability === 'coming_soon' ? 'Coming soon' : 'Unavailable'}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
