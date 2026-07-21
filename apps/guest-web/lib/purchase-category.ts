import type { PurchaseCategory } from './types';

/** Mirrors `apps/mobile/lib/features/create_vink/purchase_category.dart`'s label table —
 * the same human category names on both clients. */
export const CATEGORY_LABELS: Record<PurchaseCategory, string> = {
  GROCERY: 'Grocery run',
  RETAIL: 'Retail purchase',
  ELECTRONICS: 'Electronics purchase',
  RESTAURANT: 'Restaurant bill',
  HOTEL: 'Hotel stay',
  FUEL: 'Fuel',
  CAR_RENTAL: 'Car rental',
};
