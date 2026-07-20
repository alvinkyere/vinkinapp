import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/analytics/analytics.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/errors/api_exception.dart';
import '../../core/errors/human_errors.dart';
import '../../core/models/vink.dart';
import '../../core/split/split_calculator.dart';
import '../../design_system/components/money_text.dart';
import '../../design_system/components/vink_amount_summary.dart';
import '../../design_system/components/vink_bottom_sheet.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_empty_state.dart';
import '../../design_system/components/vink_inline_error.dart';
import '../../design_system/components/vink_participant_row.dart';
import '../../design_system/components/vink_step_header.dart';
import '../../design_system/components/vink_surface_card.dart';
import '../../design_system/components/vink_text_field.dart';
import '../../design_system/vink_colors.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';
import '../home/home_providers.dart';
import 'add_person_sheet.dart';
import 'person_entry.dart';
import 'purchase_category.dart';

const _stepPurpose = 0;
const _stepTotal = 1;
const _stepPeople = 2;
const _stepSplit = 3;
const _stepReview = 4;
const _stepCount = 5;

enum _SplitMode { equal, custom }

/// The five-step create-Vink flow (design correction milestone): Purpose → Total → Add
/// people → Split → Review. The vink itself is created on the network only once Purpose
/// and Total are both chosen (the backend's `createSchema` requires both together) — steps
/// 0–1 are local-only, everything from step 2 onward mutates the real DRAFT vink.
class CreateVinkScreen extends ConsumerStatefulWidget {
  const CreateVinkScreen({super.key});

  @override
  ConsumerState<CreateVinkScreen> createState() => _CreateVinkScreenState();
}

class _CreateVinkScreenState extends ConsumerState<CreateVinkScreen> {
  int _step = _stepPurpose;

  // Step 0 — Purpose
  String _category = purchaseCategories.first;

  // Step 1 — Total
  final _totalController = TextEditingController();
  String? _totalError;

  // Created after step 1
  String? _vinkId;
  int _requiredAmountMinor = 0;

  // Step 2 — Add people
  PersonEntry? _organizer;
  bool _includeOrganizer = true;
  final List<PersonEntry> _people = [];

  // Step 3 — Split
  _SplitMode _splitMode = _SplitMode.equal;
  final Map<String, TextEditingController> _customControllers = {};

  // Step 4 — Review
  VinkSnapshot? _reviewSnapshot;

  bool _busy = false;
  String? _error;

  Analytics get _analytics => ref.read(analyticsProvider);

  @override
  void dispose() {
    _totalController.dispose();
    for (final controller in _customControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  List<PersonEntry> get _financiallyIncluded => [
    if (_includeOrganizer && _organizer != null) _organizer!,
    ..._people,
  ];

  List<PersonEntry> get _allParticipants => [if (_organizer != null) _organizer!, ..._people];

  Future<void> _confirmLeave() async {
    if (_vinkId == null) {
      context.pop();
      return;
    }
    final leave = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: VinkColors.paper,
        title: const Text('Leave without finishing?'),
        content: const Text('Your Vink is saved as a draft — you can pick up where you left off from Home.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Keep editing')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Leave')),
        ],
      ),
    );
    if (leave == true && mounted) {
      ref.invalidate(myVinksProvider);
      context.pop();
    }
  }

  Future<void> _createVinkAndContinue() async {
    final dollars = double.tryParse(_totalController.text.trim());
    if (dollars == null || dollars <= 0) {
      setState(() => _totalError = 'Enter an amount greater than zero.');
      return;
    }
    setState(() {
      _busy = true;
      _totalError = null;
    });
    try {
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
        _organizer = PersonEntry(
          participantId: organizerParticipant['id'] as String,
          displayName: organizerParticipant['displayName'] as String,
          isGuest: false,
          isOrganizer: true,
        );
        _step = _stepPeople;
      });
    } on ApiException catch (error) {
      _analytics.track('create_vink_failed', {'errorCode': error.code});
      setState(() => _error = humanErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openAddPersonSheet() async {
    final vinkId = _vinkId;
    if (vinkId == null) return;
    final added = await showVinkBottomSheet<PersonEntry>(context: context, builder: (_) => AddPersonSheet(vinkId: vinkId));
    if (added != null) {
      setState(() {
        _people.add(added);
        _error = null;
      });
    }
  }

  void _goToSplit() {
    // Mirrors the backend's own OPEN_VINK gate (computeAllowedActions in
    // packages/application/src/queries.ts): a Vink needs at least one other person besides
    // the organizer before it can ever be opened, regardless of the organizer's own toggle.
    if (_people.isEmpty) {
      setState(() => _error = 'Add at least one other person before continuing.');
      return;
    }
    setState(() {
      _error = null;
      _step = _stepSplit;
    });
  }

  TextEditingController _customControllerFor(PersonEntry person, int suggestedMinor) {
    return _customControllers.putIfAbsent(
      person.participantId,
      () => TextEditingController(text: (suggestedMinor / 100).toStringAsFixed(2)),
    );
  }

  int _customAssignedMinor() {
    var total = 0;
    for (final person in _allParticipants) {
      final controller = _customControllers[person.participantId];
      final dollars = double.tryParse(controller?.text.trim() ?? '') ?? 0;
      total += (dollars * 100).round();
    }
    return total;
  }

  Future<void> _submitSplitAndReview() async {
    final vinkId = _vinkId;
    if (vinkId == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final client = ref.read(apiClientProvider);
      if (_splitMode == _SplitMode.equal && _includeOrganizer) {
        // Every active participant is financially included — the domain's own EQUAL
        // algorithm (same largest-remainder rule as split_calculator.dart) applies directly.
        await client.put('/api/v1/vinks/$vinkId/split', body: {'method': 'EQUAL'});
      } else if (_splitMode == _SplitMode.equal) {
        // Organizer excluded: EQUAL would still include them (it covers every active
        // participant), so an intentional $0 for the organizer has to go through
        // CUSTOM_AMOUNT instead — never a silent zero, always this explicit toggle's result.
        final others = _people.map((p) => p.participantId).toList();
        final shares = equalSplit(_requiredAmountMinor, others);
        final amounts = [
          {'participantId': _organizer!.participantId, 'amountMinor': 0},
          for (final share in shares) {'participantId': share.participantId, 'amountMinor': share.amountMinor},
        ];
        await client.put('/api/v1/vinks/$vinkId/split', body: {'method': 'CUSTOM_AMOUNT', 'amounts': amounts});
      } else {
        final amounts = [
          for (final person in _allParticipants)
            {
              'participantId': person.participantId,
              'amountMinor': ((double.tryParse(_customControllers[person.participantId]?.text.trim() ?? '') ?? 0) * 100).round(),
            },
        ];
        await client.put('/api/v1/vinks/$vinkId/split', body: {'method': 'CUSTOM_AMOUNT', 'amounts': amounts});
      }
      final snapshot = await client.get('/api/v1/vinks/$vinkId');
      _analytics.track('split_applied', {'method': _splitMode.name, 'participantCount': _allParticipants.length}, vinkId);
      setState(() {
        _reviewSnapshot = VinkSnapshot.fromJson(snapshot);
        _step = _stepReview;
      });
    } on ApiException catch (error) {
      _analytics.track('split_failed', {'errorCode': error.code}, vinkId);
      setState(() => _error = humanErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openVink() async {
    final vinkId = _vinkId;
    if (vinkId == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final client = ref.read(apiClientProvider);
      await client.post('/api/v1/vinks/$vinkId/open');
      _analytics.track('vink_opened', {}, vinkId);
      ref.invalidate(myVinksProvider);
      if (mounted) context.go('/vinks/$vinkId');
    } on ApiException catch (error) {
      _analytics.track('vink_open_failed', {'errorCode': error.code}, vinkId);
      setState(() => _error = humanErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _confirmLeave();
      },
      child: Scaffold(
        backgroundColor: VinkColors.paper,
        appBar: AppBar(
          backgroundColor: VinkColors.paper,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          leading: IconButton(icon: const Icon(Icons.close_rounded, color: VinkColors.ink), onPressed: _confirmLeave),
        ),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                VinkStepDots(stepIndex: _step, stepCount: _stepCount),
                const SizedBox(height: VinkSpacing.lg),
                Expanded(
                  child: switch (_step) {
                    _stepPurpose => _buildPurposeStep(),
                    _stepTotal => _buildTotalStep(),
                    _stepPeople => _buildPeopleStep(),
                    _stepSplit => _buildSplitStep(),
                    _ => _buildReviewStep(),
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPurposeStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const VinkStepHeader(title: 'What\'s this Vink for?', supportingText: 'Pick the closest category.'),
        const SizedBox(height: VinkSpacing.lg),
        Wrap(
          spacing: VinkSpacing.sm,
          runSpacing: VinkSpacing.sm,
          children: purchaseCategories.map((category) {
            final selected = _category == category;
            return ChoiceChip(
              label: Text(purchaseCategoryLabel(category)),
              selected: selected,
              labelStyle: VinkTypography.label.copyWith(color: selected ? VinkColors.white : VinkColors.ink),
              selectedColor: VinkColors.blue,
              backgroundColor: VinkColors.white,
              shape: const StadiumBorder(),
              side: BorderSide(color: selected ? VinkColors.blue : VinkColors.ink.withValues(alpha: 0.12)),
              onSelected: (_) => setState(() => _category = category),
            );
          }).toList(),
        ),
        const Spacer(),
        VinkPrimaryButton(label: 'Continue', onPressed: () => setState(() => _step = _stepTotal)),
      ],
    );
  }

  Widget _buildTotalStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const VinkStepHeader(title: 'What\'s the total?', supportingText: 'The full amount everyone will split.'),
        const SizedBox(height: VinkSpacing.xxl),
        Center(child: VinkMoneyField(controller: _totalController, autofocus: true, errorText: _totalError)),
        const Spacer(),
        if (_error != null) ...[VinkInlineError(message: _error!), const SizedBox(height: VinkSpacing.md)],
        Row(
          children: [
            Expanded(child: VinkSecondaryButton(label: 'Back', onPressed: () => setState(() => _step = _stepPurpose))),
            const SizedBox(width: VinkSpacing.sm),
            Expanded(child: VinkPrimaryButton(label: 'Continue', loading: _busy, onPressed: _createVinkAndContinue)),
          ],
        ),
      ],
    );
  }

  Widget _buildPeopleStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const VinkStepHeader(title: 'Who\'s in?', supportingText: 'You\'re already included — add anyone else splitting this.'),
        const SizedBox(height: VinkSpacing.lg),
        Expanded(
          child: ListView(
            children: [
              if (_organizer != null)
                VinkSurfaceCard(
                  padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.md, vertical: VinkSpacing.sm),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text('${_organizer!.displayName} · You', style: VinkTypography.participantName),
                      ),
                      Switch(
                        value: _includeOrganizer,
                        activeThumbColor: VinkColors.blue,
                        onChanged: (value) => setState(() => _includeOrganizer = value),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: VinkSpacing.xs),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.sm),
                child: Text(
                  _includeOrganizer ? 'Include me in this Vink' : 'Not paying a share of this Vink',
                  style: VinkTypography.bodySmallSecondary,
                ),
              ),
              const SizedBox(height: VinkSpacing.lg),
              for (final person in _people) ...[
                VinkSurfaceCard(
                  padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.md, vertical: VinkSpacing.sm),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(person.displayName, style: VinkTypography.participantName),
                      ),
                      Text(person.isGuest ? 'Guest' : 'Member', style: VinkTypography.bodySmallSecondary),
                    ],
                  ),
                ),
                const SizedBox(height: VinkSpacing.sm),
              ],
              if (_people.isEmpty)
                VinkEmptyState(
                  title: 'Add the rest of your group',
                  message: 'Existing VinkIn members can be added by username; anyone else can join as a guest, no account needed.',
                  action: VinkSecondaryButton(label: 'Add someone', onPressed: _openAddPersonSheet),
                )
              else
                Align(
                  alignment: Alignment.centerLeft,
                  child: VinkSecondaryButton(label: 'Add someone', onPressed: _openAddPersonSheet),
                ),
              if (_error != null) ...[const SizedBox(height: VinkSpacing.md), VinkInlineError(message: _error!)],
            ],
          ),
        ),
        const SizedBox(height: VinkSpacing.md),
        VinkPrimaryButton(label: 'Continue', onPressed: _goToSplit),
      ],
    );
  }

  Widget _buildSplitStep() {
    final included = _financiallyIncluded;
    final preview = equalSplit(_requiredAmountMinor, included.map((p) => p.participantId).toList());
    final previewById = {for (final share in preview) share.participantId: share.amountMinor};

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const VinkStepHeader(title: 'How should everyone pay?', supportingText: 'Split it evenly, or set custom amounts.'),
        const SizedBox(height: VinkSpacing.lg),
        Row(
          children: [
            Expanded(
              child: _SplitModeChip(
                label: 'Equal',
                selected: _splitMode == _SplitMode.equal,
                onTap: () => setState(() => _splitMode = _SplitMode.equal),
              ),
            ),
            const SizedBox(width: VinkSpacing.sm),
            Expanded(
              child: _SplitModeChip(
                label: 'Custom',
                selected: _splitMode == _SplitMode.custom,
                onTap: () => setState(() => _splitMode = _SplitMode.custom),
              ),
            ),
          ],
        ),
        const SizedBox(height: VinkSpacing.lg),
        Expanded(
          child: _splitMode == _SplitMode.equal
              ? ListView(
                  children: [
                    for (final person in _allParticipants)
                      VinkParticipantRow(
                        name: person.displayName,
                        amountMinor: previewById[person.participantId] ?? 0,
                        paymentState: VinkParticipantPaymentState.waiting,
                        isSelf: person.isOrganizer,
                        roleLabel: person.isOrganizer ? 'Organizer' : (person.isGuest ? 'Guest' : null),
                      ),
                  ],
                )
              : ListView(
                  children: [
                    for (final person in _allParticipants)
                      Padding(
                        padding: const EdgeInsets.only(bottom: VinkSpacing.sm),
                        child: Row(
                          children: [
                            Expanded(
                              flex: 2,
                              child: Text(
                                person.isOrganizer ? '${person.displayName} · You' : person.displayName,
                                style: VinkTypography.body,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const SizedBox(width: VinkSpacing.sm),
                            Expanded(
                              child: TextField(
                                controller: _customControllerFor(person, previewById[person.participantId] ?? 0),
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                textAlign: TextAlign.right,
                                onChanged: (_) => setState(() {}),
                                decoration: const InputDecoration(prefixText: '\$ ', isDense: true),
                              ),
                            ),
                          ],
                        ),
                      ),
                    const SizedBox(height: VinkSpacing.md),
                    VinkAmountSummary(totalMinor: _requiredAmountMinor, assignedMinor: _customAssignedMinor()),
                  ],
                ),
        ),
        if (_error != null) ...[const SizedBox(height: VinkSpacing.sm), VinkInlineError(message: _error!)],
        const SizedBox(height: VinkSpacing.md),
        Row(
          children: [
            Expanded(child: VinkSecondaryButton(label: 'Back', onPressed: () => setState(() => _step = _stepPeople))),
            const SizedBox(width: VinkSpacing.sm),
            Expanded(
              child: VinkPrimaryButton(
                label: 'Continue',
                loading: _busy,
                onPressed: (_splitMode == _SplitMode.custom && _customAssignedMinor() != _requiredAmountMinor)
                    ? null
                    : _submitSplitAndReview,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildReviewStep() {
    final snapshot = _reviewSnapshot;
    if (snapshot == null) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const VinkStepHeader(title: 'Review your Vink'),
        const SizedBox(height: VinkSpacing.lg),
        Expanded(
          child: ListView(
            children: [
              VinkSurfaceCard(
                elevated: true,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(purchaseCategoryLabel(snapshot.vink.purchaseCategory), style: VinkTypography.cardTitle),
                        MoneyText(snapshot.vink.requiredAmountMinor, style: VinkTypography.amountMedium),
                      ],
                    ),
                    const SizedBox(height: VinkSpacing.md),
                    for (final participant in snapshot.participants)
                      VinkParticipantRow(
                        name: participant.displayName,
                        amountMinor: participant.allocatedAmountMinor,
                        paymentState: VinkParticipantPaymentState.waiting,
                        isSelf: participant.isOrganizer,
                        roleLabel: participant.isOrganizer ? 'Organizer' : (participant.isGuest ? 'Guest' : null),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: VinkSpacing.md),
              Row(
                children: [
                  Expanded(
                    child: VinkTextButton(label: 'Edit people', onPressed: () => setState(() => _step = _stepPeople)),
                  ),
                  Expanded(
                    child: VinkTextButton(label: 'Edit split', onPressed: () => setState(() => _step = _stepSplit)),
                  ),
                ],
              ),
              if (_error != null) ...[const SizedBox(height: VinkSpacing.sm), VinkInlineError(message: _error!)],
            ],
          ),
        ),
        const SizedBox(height: VinkSpacing.md),
        VinkPrimaryButton(label: 'Open Vink', glow: true, loading: _busy, onPressed: _openVink),
      ],
    );
  }
}

class _SplitModeChip extends StatelessWidget {
  const _SplitModeChip({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(vertical: VinkSpacing.sm + 2),
          decoration: BoxDecoration(
            color: selected ? VinkColors.blue : VinkColors.white,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: selected ? VinkColors.blue : VinkColors.ink.withValues(alpha: 0.12)),
          ),
          child: Text(
            label,
            style: VinkTypography.label.copyWith(color: selected ? VinkColors.white : VinkColors.ink),
          ),
        ),
      ),
    );
  }
}
