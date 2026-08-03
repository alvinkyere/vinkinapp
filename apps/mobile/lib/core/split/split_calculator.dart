/// Deterministic largest-remainder allocation — mirrors the backend's own EQUAL split
/// algorithm (packages/domain/src/split-engine.ts's "stable join order makes the EQUAL
/// remainder deterministic," Plan §15) so the app's preview and the server's actual split
/// always agree, to the cent. Integer minor units throughout (Plan §15) — never a double.
class SplitAllocation {
  const SplitAllocation({
    required this.participantId,
    required this.amountMinor,
  });
  final String participantId;
  final int amountMinor;
}

/// Splits [totalMinor] equally among [participantIds] (in the given, stable order),
/// distributing the leftover cent-by-cent to the first participants in that order — the
/// same rule the backend uses, so shares always sum exactly to the total (never rounded
/// independently in a way that creates a mismatch).
List<SplitAllocation> equalSplit(int totalMinor, List<String> participantIds) {
  if (participantIds.isEmpty) return const [];
  final count = participantIds.length;
  final base = totalMinor ~/ count;
  final remainder = totalMinor % count;
  return [
    for (var i = 0; i < count; i++)
      SplitAllocation(
        participantId: participantIds[i],
        amountMinor: base + (i < remainder ? 1 : 0),
      ),
  ];
}

int sumAllocations(Iterable<int> amountsMinor) =>
    amountsMinor.fold(0, (sum, amount) => sum + amount);
