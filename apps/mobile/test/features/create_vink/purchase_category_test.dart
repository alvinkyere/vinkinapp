import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/features/create_vink/purchase_category.dart';

void main() {
  test(
    'every supported category has a human label distinct from the raw enum value',
    () {
      for (final category in purchaseCategories) {
        final label = purchaseCategoryLabel(category);
        expect(
          label,
          isNot(equals(category)),
          reason: '$category must not leak its raw backend name to the UI',
        );
        expect(label, isNotEmpty);
      }
    },
  );

  test(
    'an unrecognized category falls back to itself rather than throwing',
    () {
      expect(purchaseCategoryLabel('SOMETHING_NEW'), 'SOMETHING_NEW');
    },
  );

  group('Slice 3 — purchaseCategoryIcon', () {
    test('every supported category has its own distinct icon', () {
      final icons = purchaseCategories.map(purchaseCategoryIcon).toSet();
      expect(
        icons.length,
        purchaseCategories.length,
        reason: 'no two categories should share an icon',
      );
    });

    test(
      'an unrecognized category falls back to a generic icon rather than throwing',
      () {
        expect(purchaseCategoryIcon('SOMETHING_NEW'), isA<IconData>());
      },
    );
  });
}
