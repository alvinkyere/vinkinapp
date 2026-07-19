export function formatMoney(amountMinor: number | string, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
    Number(amountMinor) / 100,
  );
}
