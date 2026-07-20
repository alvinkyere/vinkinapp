import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/core/split/split_calculator.dart';

void main() {
  group('equalSplit', () {
    test('divides evenly when the total divides cleanly', () {
      final result = equalSplit(12000, ['a', 'b', 'c', 'd']);
      expect(result.map((a) => a.amountMinor).toList(), [3000, 3000, 3000, 3000]);
      expect(sumAllocations(result.map((a) => a.amountMinor)), 12000);
    });

    test('distributes the remainder deterministically, largest-remainder style (\$100 / 3)', () {
      final result = equalSplit(10000, ['alvin', 'ama', 'kwame']);
      expect(result[0].amountMinor, 3334); // $33.34
      expect(result[1].amountMinor, 3333); // $33.33
      expect(result[2].amountMinor, 3333); // $33.33
      expect(sumAllocations(result.map((a) => a.amountMinor)), 10000);
    });

    test('shares always sum exactly to the total for an adversarial set of totals', () {
      for (final total in [1, 7, 100, 9999, 123456, 1, 2, 3]) {
        for (final count in [1, 2, 3, 5, 7]) {
          final ids = List.generate(count, (i) => 'p$i');
          final result = equalSplit(total, ids);
          expect(sumAllocations(result.map((a) => a.amountMinor)), total, reason: 'total=$total count=$count');
        }
      }
    });

    test('organizer included: divisor covers everyone, including the organizer', () {
      final result = equalSplit(12000, ['organizer', 'ama', 'kwame', 'nana-guest']);
      expect(result.length, 4);
      expect(result.every((a) => a.amountMinor == 3000), isTrue);
    });

    test('organizer excluded: divisor covers only the other participants', () {
      final result = equalSplit(9000, ['ama', 'kwame', 'nana-guest']);
      expect(result.length, 3);
      expect(result.every((a) => a.amountMinor == 3000), isTrue);
      // The organizer simply never appears in the input list — the caller's
      // "Include me" toggle controls this, not the allocator.
    });

    test('empty participant list returns no allocations', () {
      expect(equalSplit(1000, []), isEmpty);
    });
  });

  group('sumAllocations', () {
    test('sums an empty iterable to zero', () {
      expect(sumAllocations([]), 0);
    });
  });
}
