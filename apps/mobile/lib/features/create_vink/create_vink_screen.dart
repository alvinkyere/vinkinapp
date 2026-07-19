import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/errors/api_exception.dart';
import '../../core/models/vink.dart';
import '../../core/analytics/analytics.dart';
import '../../design_system/colors/vinkin_colors.dart';
import '../../design_system/components/money_text.dart';
import '../../design_system/components/vinkin_button.dart';
import '../../design_system/spacing/vinkin_spacing.dart';
import '../../design_system/typography/vinkin_typography.dart';
import '../home/home_providers.dart';

/// Plan §20 screens 5–10 (category → total → split → participants → lobby handoff)
/// collapsed into one guided flow — a pragmatic PV9 scope choice (flagged in the
/// milestone report) rather than one route per screen, since each step depends on the
/// vink id the previous step creates.
const _supportedCategories = ['GROCERY', 'RETAIL', 'ELECTRONICS']; // EXACT_FINAL, always on

class CreateVinkScreen extends ConsumerStatefulWidget {
  const CreateVinkScreen({super.key});

  @override
  ConsumerState<CreateVinkScreen> createState() => _CreateVinkScreenState();
}

class _CreateVinkScreenState extends ConsumerState<CreateVinkScreen> {
  int _step = 0;
  String _category = _supportedCategories.first;
  final _totalController = TextEditingController(text: '120.00');
  final _participantController = TextEditingController();
  String? _vinkId;
  String? _organizerParticipantId;
  int _requiredAmountMinor = 0;
  final List<String> _addedUsernames = [];
  final List<String> _addedParticipantIds = [];
  VinkSnapshot? _splitPreview;
  bool _busy = false;
  String? _error;

  Analytics get _analytics => ref.read(analyticsProvider);

  Future<void> _createVink() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final dollars = double.tryParse(_totalController.text.trim());
      if (dollars == null || dollars <= 0) throw const ApiException(statusCode: 0, code: 'INVALID_AMOUNT', message: 'Enter an amount greater than zero.');
      final subtotalMinor = (dollars * 100).round();
      final client = ref.read(apiClientProvider);
      final authState = ref.read(authControllerProvider);
      final displayName = authState is AuthSignedIn ? authState.user.displayName : 'Organizer';
      final response = await client.post(
        '/api/v1/vinks',
        body: {
          'purchaseCategory': _category,
          'subtotalMinor': subtotalMinor,
          'tipMinor': 0,
          'submissionDeadline': DateTime.now().toUtc().add(const Duration(hours: 24)).toIso8601String(),
          'organizerDisplayName': displayName,
        },
      );
      final vink = response['vink'] as Map<String, dynamic>;
      final organizerParticipant = (response['participants'] as List<dynamic>).first as Map<String, dynamic>;
      final vinkId = vink['id'] as String;
      _analytics.track('create_vink_submitted', {'category': _category, 'subtotalMinor': subtotalMinor}, vinkId);
      setState(() {
        _vinkId = vinkId;
        _requiredAmountMinor = subtotalMinor;
        _organizerParticipantId = organizerParticipant['id'] as String;
        _step = 1;
      });
    } on ApiException catch (error) {
      _analytics.track('create_vink_failed', {'errorCode': error.code});
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addParticipant() async {
    final username = _participantController.text.trim();
    if (username.isEmpty || _vinkId == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final client = ref.read(apiClientProvider);
      final participant = await client.post('/api/v1/vinks/$_vinkId/participants', body: {'username': username});
      setState(() {
        _addedUsernames.add(username);
        _addedParticipantIds.add(participant['id'] as String);
        _participantController.clear();
      });
    } on ApiException catch (error) {
      setState(() => _error = error.code == 'USER_NOT_FOUND' ? 'No user "$username" — they need an account first.' : error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Splits the total equally among the ADDED participants, with the organizer at $0 —
  /// via CUSTOM_AMOUNT rather than the domain's own EQUAL split (which would also make the
  /// organizer a payer). PV9 has no "approve my own contribution" affordance for the
  /// organizer yet (flagged in the milestone report as a real, small scope gap), so the
  /// organizer fronting $0 and being reimbursed is the sensible default for this app,
  /// matching how the pooled-card product actually works in practice.
  Future<void> _applySplitAndReview() async {
    if (_vinkId == null || _organizerParticipantId == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final client = ref.read(apiClientProvider);
      final count = _addedParticipantIds.length;
      final base = _requiredAmountMinor ~/ count;
      final remainder = _requiredAmountMinor % count;
      final amounts = [
        {'participantId': _organizerParticipantId, 'amountMinor': 0},
        for (var i = 0; i < count; i++)
          {'participantId': _addedParticipantIds[i], 'amountMinor': base + (i < remainder ? 1 : 0)},
      ];
      await client.put('/api/v1/vinks/$_vinkId/split', body: {'method': 'CUSTOM_AMOUNT', 'amounts': amounts});
      final snapshot = await client.get('/api/v1/vinks/$_vinkId');
      _analytics.track('split_applied', {'participantCount': count}, _vinkId);
      setState(() {
        _splitPreview = VinkSnapshot.fromJson(snapshot);
        _step = 2;
      });
    } on ApiException catch (error) {
      _analytics.track('split_failed', {'errorCode': error.code}, _vinkId);
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openVink() async {
    if (_vinkId == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final client = ref.read(apiClientProvider);
      await client.post('/api/v1/vinks/$_vinkId/open');
      // The E1 exit-gate moment for the organizer's own task funnel: everything from here
      // (funding/card/completion) is driven by participants and the deadline sweep, not the
      // organizer's further action.
      _analytics.track('vink_opened', {}, _vinkId);
      ref.invalidate(myVinksProvider);
      if (mounted) context.go('/vinks/$_vinkId');
    } on ApiException catch (error) {
      _analytics.track('vink_open_failed', {'errorCode': error.code}, _vinkId);
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New Vink')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(VinkinSpacing.lg),
          child: switch (_step) {
            0 => _buildDetailsStep(),
            1 => _buildParticipantsStep(),
            _ => _buildReviewStep(),
          },
        ),
      ),
    );
  }

  Widget _buildDetailsStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('What are you buying?', style: VinkinTypography.title),
        const SizedBox(height: VinkinSpacing.md),
        Wrap(
          spacing: VinkinSpacing.sm,
          children: _supportedCategories
              .map(
                (category) => ChoiceChip(
                  label: Text(category),
                  selected: _category == category,
                  onSelected: (_) => setState(() => _category = category),
                ),
              )
              .toList(),
        ),
        const SizedBox(height: VinkinSpacing.lg),
        TextField(
          controller: _totalController,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Total amount', prefixText: '\$ '),
        ),
        if (_error != null) ...[
          const SizedBox(height: VinkinSpacing.sm),
          Text(_error!, style: VinkinTypography.bodySecondary.copyWith(color: VinkinColors.danger)),
        ],
        const Spacer(),
        VinkinButton(label: 'Continue', loading: _busy, onPressed: _createVink),
      ],
    );
  }

  Widget _buildParticipantsStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('Who\'s splitting this?', style: VinkinTypography.title),
        const SizedBox(height: VinkinSpacing.xs),
        const Text('Add participants by username. They need a VinkIn account already.', style: VinkinTypography.bodySecondary),
        const SizedBox(height: VinkinSpacing.md),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _participantController,
                decoration: const InputDecoration(labelText: 'Username'),
                onSubmitted: (_) => _addParticipant(),
              ),
            ),
            const SizedBox(width: VinkinSpacing.sm),
            IconButton.filled(onPressed: _busy ? null : _addParticipant, icon: const Icon(Icons.add)),
          ],
        ),
        if (_error != null) ...[
          const SizedBox(height: VinkinSpacing.sm),
          Text(_error!, style: VinkinTypography.bodySecondary.copyWith(color: VinkinColors.danger)),
        ],
        const SizedBox(height: VinkinSpacing.md),
        Expanded(
          child: ListView(
            children: _addedUsernames
                .map((username) => ListTile(leading: const Icon(Icons.person_outline), title: Text(username)))
                .toList(),
          ),
        ),
        VinkinButton(
          label: 'Split equally & review',
          loading: _busy,
          onPressed: _addedUsernames.isEmpty ? null : _applySplitAndReview,
        ),
      ],
    );
  }

  Widget _buildReviewStep() {
    final snapshot = _splitPreview;
    if (snapshot == null) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('Review & open', style: VinkinTypography.title),
        const SizedBox(height: VinkinSpacing.md),
        MoneyText(snapshot.vink.requiredAmountMinor, style: VinkinTypography.display),
        const SizedBox(height: VinkinSpacing.sm),
        const Text('Split equally between:', style: VinkinTypography.label),
        Expanded(
          child: ListView(
            children: snapshot.participants
                .map(
                  (participant) => ListTile(
                    title: Text(participant.displayName.isEmpty ? participant.role : participant.displayName),
                    trailing: MoneyText(participant.allocatedAmountMinor, style: VinkinTypography.body),
                  ),
                )
                .toList(),
          ),
        ),
        if (_error != null) ...[
          Text(_error!, style: VinkinTypography.bodySecondary.copyWith(color: VinkinColors.danger)),
          const SizedBox(height: VinkinSpacing.sm),
        ],
        VinkinButton(label: 'Open Vink', loading: _busy, onPressed: _openVink),
      ],
    );
  }
}
