// Slice I6 (Phase 3 §1) — direct unit tests for Home's needs-attention/waiting-on-others
// classification, the I6 brief's own named requirement. Pure functions, no widget/provider
// scaffolding needed.

import 'package:flutter_test/flutter_test.dart';
import 'package:vinkin_mobile/features/home/home_providers.dart';

void main() {
  group('organizerAttentionBucket', () {
    test(
      'RESTRICTED is always needs-attention — the found-and-fixed reachability gap',
      () {
        expect(
          organizerAttentionBucket(
            vinkState: 'RESTRICTED',
            allowedActions: const [],
            ownContributionStatus: 'AUTHORIZED',
          ),
          AttentionBucket.needsAttention,
        );
      },
    );

    test('OPEN with the own share unpaid is needs-attention', () {
      expect(
        organizerAttentionBucket(
          vinkState: 'OPEN',
          allowedActions: const [],
          ownContributionStatus: null,
        ),
        AttentionBucket.needsAttention,
      );
    });

    test(
      'OPEN with the own share already paid, and nothing else actionable, waits on others',
      () {
        expect(
          organizerAttentionBucket(
            vinkState: 'OPEN',
            allowedActions: const [],
            ownContributionStatus: 'AUTHORIZED',
          ),
          AttentionBucket.waitingOnOthers,
        );
      },
    );

    test('DRAFT with OPEN_VINK actionable is needs-attention', () {
      expect(
        organizerAttentionBucket(
          vinkState: 'DRAFT',
          allowedActions: const ['OPEN_VINK'],
          ownContributionStatus: null,
        ),
        AttentionBucket.needsAttention,
      );
    });

    test('COVER_REMAINING actionable is needs-attention', () {
      expect(
        organizerAttentionBucket(
          vinkState: 'OPEN',
          allowedActions: const ['COVER_REMAINING'],
          ownContributionStatus: 'AUTHORIZED',
        ),
        AttentionBucket.needsAttention,
      );
    });

    test('FUNDED with nothing actionable waits on others', () {
      expect(
        organizerAttentionBucket(
          vinkState: 'FUNDED',
          allowedActions: const [],
          ownContributionStatus: 'CAPTURED',
        ),
        AttentionBucket.waitingOnOthers,
      );
    });
  });

  group('participantAttentionBucket', () {
    test(
      'RESTRICTED is deliberately NOT needs-attention for a participant — D24/D25\'s own '
      '"already settled by then" rule',
      () {
        expect(
          participantAttentionBucket(
            vinkState: 'RESTRICTED',
            ownContributionStatus: 'confirmed',
          ),
          AttentionBucket.waitingOnOthers,
        );
      },
    );

    test('OPEN with not_started is needs-attention', () {
      expect(
        participantAttentionBucket(
          vinkState: 'OPEN',
          ownContributionStatus: 'not_started',
        ),
        AttentionBucket.needsAttention,
      );
    });

    test('OPEN with declined_retryable is needs-attention', () {
      expect(
        participantAttentionBucket(
          vinkState: 'OPEN',
          ownContributionStatus: 'declined_retryable',
        ),
        AttentionBucket.needsAttention,
      );
    });

    test('OPEN with confirmed waits on others', () {
      expect(
        participantAttentionBucket(
          vinkState: 'OPEN',
          ownContributionStatus: 'confirmed',
        ),
        AttentionBucket.waitingOnOthers,
      );
    });

    test(
      'not_started on a non-OPEN state (e.g. FUNDED) waits on others — nothing left to pay',
      () {
        expect(
          participantAttentionBucket(
            vinkState: 'FUNDED',
            ownContributionStatus: 'not_started',
          ),
          AttentionBucket.waitingOnOthers,
        );
      },
    );
  });
}
