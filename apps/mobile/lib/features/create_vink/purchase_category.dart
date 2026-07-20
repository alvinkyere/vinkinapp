/// The routes.ts enum (`PURCHASE_CATEGORIES`) lists seven categories, but
/// packages/domain/src/policy.ts's `CATEGORY_POLICY` only ever accepts three today:
/// RESTAURANT needs the `restaurant_variable_policy` flag (off by default, provider/counsel
/// validation pending — same "never offer what the backend will reject" rule this milestone
/// applies to the PERCENTAGE split method); HOTEL/FUEL/CAR_RENTAL are permanently
/// unsupported for MVP (variable settlement). Offering all seven produced a real, caught
/// defect: selecting Restaurant threw UNSUPPORTED_PURCHASE_CATEGORY on create. Human labels
/// here are cosmetic only; the wire value is still the raw enum.
const purchaseCategories = ['GROCERY', 'RETAIL', 'ELECTRONICS'];

String purchaseCategoryLabel(String category) => switch (category) {
  'GROCERY' => 'Groceries',
  'RETAIL' => 'Retail',
  'ELECTRONICS' => 'Electronics',
  _ => category,
};
