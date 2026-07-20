import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/features/create_vink/purchase_category.dart';

void main() {
  test('every supported category has a human label distinct from the raw enum value', () {
    for (final category in purchaseCategories) {
      final label = purchaseCategoryLabel(category);
      expect(label, isNot(equals(category)), reason: '$category must not leak its raw backend name to the UI');
      expect(label, isNotEmpty);
    }
  });

  test('an unrecognized category falls back to itself rather than throwing', () {
    expect(purchaseCategoryLabel('SOMETHING_NEW'), 'SOMETHING_NEW');
  });
}
