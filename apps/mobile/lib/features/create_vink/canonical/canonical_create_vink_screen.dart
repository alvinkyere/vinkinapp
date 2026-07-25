import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/analytics/analytics.dart';
import '../../../core/auth/auth_controller.dart';
import '../../../core/errors/api_exception.dart';
import '../../../core/errors/failure_classifier.dart';
import '../../../core/errors/failure_handling.dart';
import '../../../core/errors/human_errors.dart';
import '../../../core/models/vink.dart';
import '../../../core/networking/idempotency_key.dart';
import '../../../core/split/split_calculator.dart';
import '../../../design_system/components/vink_amount_summary.dart';
import '../../../design_system/components/vink_bottom_sheet.dart';
import '../../../design_system/components/vink_buttons.dart';
import '../../../design_system/components/vink_empty_state.dart';
import '../../../design_system/components/vink_inline_error.dart';
import '../../../design_system/components/vink_step_header.dart';
import '../../../design_system/components/vink_text_field.dart';
import '../../../design_system/vink_colors.dart';
import '../../../design_system/vink_spacing.dart';
import '../../../design_system/vink_typography.dart';
import '../../home/home_providers.dart';
import '../local_draft_store.dart';
import '../person_entry.dart';
import '../purchase_category.dart';
import 'canonical_add_person_sheet.dart';
import 'canonical_edit_guest_sheet.dart';
import 'delivery_mode.dart';
import 'open_vink_confirmation_sheet.dart';

enum CanonicalStep { purpose, total, peopleAndSplit }

enum CanonicalSplitMode { equal, custom }

/// Slice I5 (D30) — the canonical two-screen create flow: Purpose+Total, then People+Split,
/// ending in a transient Open Vink confirmation sheet rather than a standalone Review page.
/// Flag-gated (`FeatureFlags.canonicalCreateFlow`); the five-step wizard
/// (`create_vink_screen.dart`) is untouched and remains the flag-off behavior.
///
/// Deliberate simplification vs. the five-step wizard (see the I5 completion report's
/// "deviations" section): there is no separate "include me" toggle for the organizer. The
/// organizer is always financially included by default in Equal split (matching "organizer
/// is included by default"); giving themselves a $0 share is done the same way any
/// participant's share is edited — switching to Custom and setting their own row to 0 — never
/// a special affordance beyond the "You" label (Phase 5 C11). This also means Equal mode
/// always submits a plain `{method: 'EQUAL'}` — the old flow's CUSTOM_AMOUNT-with-forced-0
/// workaround for an excluded organizer no longer applies.
class CanonicalCreateVinkScreen extends ConsumerStatefulWidget {
  const CanonicalCreateVinkScreen({super.key, this.resumeVinkId});

  final String? resumeVinkId;

  @override
  ConsumerState<CanonicalCreateVinkScreen> createState() =>
      _CanonicalCreateVinkScreenState();
}

class _CanonicalCreateVinkScreenState
    extends ConsumerState<CanonicalCreateVinkScreen> {
  CanonicalStep _step = CanonicalStep.purpose;

  // Slice I5B (D39) — human-readable payment context, required by this canonical screen
  // (not by the API itself — see `_createVinkAndContinue`'s own validation, and the D39 doc
  // comment on `CreateVinkInput.purpose`/`Vink.purpose`).
  final _purposeController = TextEditingController();
  String? _purposeError;
  String _category = purchaseCategories.first;
  final _totalController = TextEditingController();
  String? _totalError;

  String? _vinkId;
  int _requiredAmountMinor = 0;
  String? _createIdempotencyKey;

  PersonEntry? _organizer;
  final List<PersonEntry> _people = [];

  CanonicalSplitMode _splitMode = CanonicalSplitMode.equal;
  final Map<String, TextEditingController> _customControllers = {};
  Map<String, int> _confirmedAmountsByParticipantId = {};

  bool _busy = false;
  String? _error;

  final _localDraftStore = LocalDraftStore();
  bool _resuming = false;
  Object? _resumeError;

  Analytics get _analytics => ref.read(analyticsProvider);

  @override
  void initState() {
    super.initState();
    _totalController.addListener(_persistLocalDraftIfUnsaved);
    _purposeController.addListener(_persistLocalDraftIfUnsaved);
    final resumeVinkId = widget.resumeVinkId;
    if (resumeVinkId != null) {
      _loadResumeSnapshot(resumeVinkId);
    } else {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _offerLocalDraftIfAny(),
      );
    }
  }

  @override
  void dispose() {
    _totalController.removeListener(_persistLocalDraftIfUnsaved);
    _totalController.dispose();
    _purposeController.removeListener(_persistLocalDraftIfUnsaved);
    _purposeController.dispose();
    for (final controller in _customControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  List<PersonEntry> get _allParticipants => [
    if (_organizer != null) _organizer!,
    ..._people,
  ];

  /// A server-persisted DRAFT always already has category+total (the backend requires both
  /// to create one), so — unlike the five-step wizard's `resumeStepFor`, which can land on
  /// three different steps — the canonical flow's resume destination is never ambiguous:
  /// there is exactly one screen left to resume into. Never auto-advances past that into the
  /// confirmation sheet, even if the split already fully reconciles — opening is always a
  /// fresh, deliberate tap, never replayed automatically on restoration.
  Future<void> _loadResumeSnapshot(String vinkId) async {
    setState(() => _resuming = true);
    try {
      final response = await ref
          .read(apiClientProvider)
          .get('/api/v1/vinks/$vinkId');
      final snapshot = VinkSnapshot.fromJson(response);
      if (!mounted) return;
      final organizerParticipant = snapshot.participants.firstWhere(
        (p) => p.isOrganizer,
      );
      final others = snapshot.participants.where(
        (p) => !p.isOrganizer && p.status != 'REMOVED',
      );
      setState(() {
        _vinkId = vinkId;
        _purposeController.text = snapshot.vink.purpose ?? '';
        _category = snapshot.vink.purchaseCategory;
        _requiredAmountMinor = snapshot.vink.requiredAmountMinor;
        _totalController.text = (snapshot.vink.requiredAmountMinor / 100)
            .toStringAsFixed(2);
        _organizer = PersonEntry(
          participantId: organizerParticipant.id,
          displayName: organizerParticipant.displayName,
          isGuest: false,
          isOrganizer: true,
        );
        _people
          ..clear()
          ..addAll(
            others.map(
              (p) => PersonEntry(
                participantId: p.id,
                displayName: p.displayName,
                isGuest: p.isGuest,
                isOrganizer: false,
                guestJoinUrl: null, // not recoverable on resume (D14)
              ),
            ),
          );
        _step = CanonicalStep.peopleAndSplit;
        _resuming = false;
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _resumeError = error);
    }
  }

  Future<void> _persistLocalDraftIfUnsaved() async {
    if (_vinkId != null) return;
    await _localDraftStore.save(
      UnsavedDraft(
        category: _category,
        totalText: _totalController.text,
        purpose: _purposeController.text,
      ),
    );
  }

  Future<void> _offerLocalDraftIfAny() async {
    final draft = await _localDraftStore.read();
    if (draft == null || !mounted) return;
    final resume = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: VinkColors.paper,
        title: const Text('Continue your last Vink?'),
        content: Text(
          'You started setting up a ${purchaseCategoryLabel(draft.category)} Vink'
          '${draft.totalText.isEmpty ? '' : ' for \$${draft.totalText}'} but didn\'t finish.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Start over'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    if (!mounted) return;
    if (resume == true) {
      setState(() {
        _category = draft.category;
        _totalController.text = draft.totalText;
        _purposeController.text = draft.purpose;
      });
    } else {
      await _localDraftStore.clear();
    }
  }

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
        content: const Text(
          'Your Vink is saved as a draft — you can pick up where you left off from Home.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep editing'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Leave'),
          ),
        ],
      ),
    );
    if (leave == true && mounted) {
      ref.invalidate(myVinksProvider);
      context.pop();
    }
  }

  Future<void> _createVinkAndContinue() async {
    // Slice I5B (D39): the canonical screen requires a purpose — the API itself stays
    // optional (the five-step wizard hits the same endpoint and never sends one), so this
    // validation is entirely client-side, matching the total field's own existing pattern
    // (validate on submit, not a proactively-disabled button).
    final purpose = _purposeController.text.trim();
    if (purpose.isEmpty) {
      setState(() => _purposeError = 'Tell everyone what this Vink is for.');
      return;
    }
    final dollars = double.tryParse(_totalController.text.trim());
    if (dollars == null || dollars <= 0) {
      setState(() => _totalError = 'Enter an amount greater than zero.');
      return;
    }
    setState(() {
      _busy = true;
      _purposeError = null;
      _totalError = null;
    });
    try {
      final subtotalMinor = (dollars * 100).round();
      final client = ref.read(apiClientProvider);
      final authState = ref.read(authControllerProvider);
      final displayName = authState is AuthSignedIn
          ? authState.user.displayName
          : 'Organizer';
      _createIdempotencyKey ??= newIdempotencyKey();
      final response = await client.post(
        '/api/v1/vinks',
        body: {
          'purpose': purpose,
          'purchaseCategory': _category,
          'subtotalMinor': subtotalMinor,
          'tipMinor': 0,
          'organizerDisplayName': displayName,
          'creationIdempotencyKey': _createIdempotencyKey,
        },
      );
      final vink = response['vink'] as Map<String, dynamic>;
      final organizerParticipant =
          (response['participants'] as List<dynamic>).first
              as Map<String, dynamic>;
      final vinkId = vink['id'] as String;
      _analytics.track('create_vink_submitted', {
        'category': _category,
        'subtotalMinor': subtotalMinor,
      }, vinkId);
      unawaited(_localDraftStore.clear());
      setState(() {
        _vinkId = vinkId;
        _requiredAmountMinor = subtotalMinor;
        _organizer = PersonEntry(
          participantId: organizerParticipant['id'] as String,
          displayName: organizerParticipant['displayName'] as String,
          isGuest: false,
          isOrganizer: true,
        );
        _step = CanonicalStep.peopleAndSplit;
      });
    } on ApiException catch (error) {
      _analytics.track('create_vink_failed', {'errorCode': error.code});
      setState(() => _error = presentFailure(ref, error).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _continueFromPurpose() {
    if (_purposeController.text.trim().isEmpty) {
      setState(() => _purposeError = 'Tell everyone what this Vink is for.');
      return;
    }
    setState(() {
      _purposeError = null;
      _error = null;
      _step = CanonicalStep.total;
    });
  }

  Future<void> _openAddPersonSheet() async {
    final vinkId = _vinkId;
    if (vinkId == null) return;
    final added = await showVinkBottomSheet<PersonEntry>(
      context: context,
      builder: (_) => CanonicalAddPersonSheet(vinkId: vinkId),
    );
    if (added != null) {
      setState(() {
        _people.add(added);
        _error = null;
      });
    }
  }

  /// Slice I5B (D40) — draft-only guest correction. Members have nothing to edit here (their
  /// automatic delivery is entirely account-driven, I4) — this is only ever reachable for a
  /// guest row.
  Future<void> _openEditGuestSheet(PersonEntry person) async {
    final vinkId = _vinkId;
    if (vinkId == null) return;
    final edited = await showVinkBottomSheet<PersonEntry>(
      context: context,
      builder: (_) => CanonicalEditGuestSheet(vinkId: vinkId, person: person),
    );
    if (edited == null) return;
    setState(() {
      final index = _people.indexWhere(
        (existing) => existing.participantId == person.participantId,
      );
      if (index != -1) _people[index] = edited;
      _error = null;
    });
  }

  /// Slice I5B (D40) — removal itself reuses the EXISTING `removeParticipantCommand`/
  /// `DELETE .../participants/:id` route (unchanged, already organizer-owned and already
  /// rejects removing the organizer) — nothing new on the backend for this action. Equal
  /// recalculates immediately because it's computed live from `_allParticipants` on every
  /// build; Custom simply loses whatever amount was in that row's now-disposed controller, so
  /// `_customAssignedMinor()` — and therefore `_canContinueToConfirmation` — reflects the
  /// removal on the very next frame, with no separate "recheck" step needed.
  Future<void> _removeParticipant(PersonEntry person) async {
    final vinkId = _vinkId;
    if (vinkId == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: VinkColors.paper,
        title: Text('Remove ${person.displayName}?'),
        content: const Text('They\'ll no longer be part of this Vink.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref
          .read(apiClientProvider)
          .delete('/api/v1/vinks/$vinkId/participants/${person.participantId}');
      final removedController = _customControllers.remove(person.participantId);
      removedController?.dispose();
      if (mounted) {
        setState(() {
          _people.removeWhere(
            (existing) => existing.participantId == person.participantId,
          );
          _error = null;
        });
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = presentFailure(ref, error).message);
    }
  }

  TextEditingController _customControllerFor(
    PersonEntry person,
    int suggestedMinor,
  ) {
    return _customControllers.putIfAbsent(
      person.participantId,
      () => TextEditingController(
        text: (suggestedMinor / 100).toStringAsFixed(2),
      ),
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

  bool get _canContinueToConfirmation {
    if (_people.isEmpty) return false;
    if (_splitMode == CanonicalSplitMode.custom) {
      return _customAssignedMinor() == _requiredAmountMinor;
    }
    return true;
  }

  Future<void> _submitSplitAndOpenConfirmation() async {
    final vinkId = _vinkId;
    if (vinkId == null) return;
    if (_people.isEmpty) {
      setState(
        () => _error = 'Add at least one other person before continuing.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final client = ref.read(apiClientProvider);
      if (_splitMode == CanonicalSplitMode.equal) {
        // The organizer is always financially included in Equal (no exclusion toggle in the
        // canonical flow) — every active participant, no CUSTOM_AMOUNT workaround needed.
        await client.put(
          '/api/v1/vinks/$vinkId/split',
          body: {'method': 'EQUAL'},
        );
      } else {
        final amounts = [
          for (final person in _allParticipants)
            {
              'participantId': person.participantId,
              'amountMinor':
                  ((double.tryParse(
                                _customControllers[person.participantId]?.text
                                        .trim() ??
                                    '',
                              ) ??
                              0) *
                          100)
                      .round(),
            },
        ];
        await client.put(
          '/api/v1/vinks/$vinkId/split',
          body: {'method': 'CUSTOM_AMOUNT', 'amounts': amounts},
        );
      }
      final snapshotJson = await client.get('/api/v1/vinks/$vinkId');
      final snapshot = VinkSnapshot.fromJson(snapshotJson);
      _analytics.track('split_applied', {
        'method': _splitMode.name,
        'participantCount': _allParticipants.length,
      }, vinkId);
      if (!mounted) return;
      setState(() {
        _confirmedAmountsByParticipantId = {
          for (final participant in snapshot.participants)
            participant.id: participant.allocatedAmountMinor,
        };
        // Cleared BEFORE opening the confirmation sheet, not in a shared `finally` below — the
        // sheet has its own independent `submitting` state (`_openConfirmationSheet`), and
        // leaving this screen's button stuck on `loading: true` for as long as the sheet stays
        // open would keep its spinner's indeterminate animation running the whole time.
        _busy = false;
      });
      await _openConfirmationSheet();
    } on ApiException catch (error) {
      _analytics.track('split_failed', {'errorCode': error.code}, vinkId);
      if (mounted) {
        setState(() {
          _error = presentFailure(ref, error).message;
          _busy = false;
        });
      }
    }
  }

  /// Phase 5 C15 / Phase 4 §5c: a transient sheet, not a page. `submitting`/`openError` live
  /// only in this closure's `StatefulBuilder` — nothing here survives a rebuild of the
  /// screen behind it, and dismissing the sheet (back or background tap, both handled by
  /// `showVinkBottomSheet`'s own `showModalBottomSheet`) returns to People+Split with every
  /// field exactly as it was, since this widget owns none of that data.
  Future<void> _openConfirmationSheet() async {
    final vinkId = _vinkId;
    if (vinkId == null) return;
    var submitting = false;
    String? openError;
    await showVinkBottomSheet<void>(
      context: context,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setSheetState) {
          Future<void> handleOpen() async {
            setSheetState(() {
              submitting = true;
              openError = null;
            });
            try {
              final client = ref.read(apiClientProvider);
              await client.post('/api/v1/vinks/$vinkId/open');
              _analytics.track('vink_opened', {}, vinkId);
              ref.invalidate(myVinksProvider);
              if (mounted) {
                Navigator.of(sheetContext).pop();
                context.go('/vinks/$vinkId');
              }
            } on ApiException catch (error) {
              _analytics.track('vink_open_failed', {
                'errorCode': error.code,
              }, vinkId);
              final failure = presentFailure(ref, error);
              if (failure.category == FailureCategory.conflict) {
                try {
                  final snapshot = await ref
                      .read(apiClientProvider)
                      .get('/api/v1/vinks/$vinkId');
                  if (VinkSnapshot.fromJson(snapshot).vink.state != 'DRAFT') {
                    ref.invalidate(myVinksProvider);
                    if (mounted) {
                      Navigator.of(sheetContext).pop();
                      context.go('/vinks/$vinkId');
                    }
                    return;
                  }
                } on ApiException {
                  // Fall through to the normal error path below.
                }
              }
              setSheetState(() {
                submitting = false;
                openError = failure.message;
              });
            }
          }

          return OpenVinkConfirmationSheet(
            category: _category,
            requiredAmountMinor: _requiredAmountMinor,
            participants: _allParticipants,
            amountsMinorByParticipantId: _confirmedAmountsByParticipantId,
            submitting: submitting,
            errorMessage: openError,
            onOpen: () => unawaited(handleOpen()),
          );
        },
      ),
    );
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
          leading: IconButton(
            icon: const Icon(Icons.close_rounded, color: VinkColors.ink),
            onPressed: _confirmLeave,
          ),
        ),
        body: SafeArea(child: _buildBody()),
      ),
    );
  }

  Widget _buildBody() {
    if (_resumeError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(VinkSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              VinkInlineError(
                message: _resumeError is ApiException
                    ? humanErrorMessage(_resumeError as ApiException)
                    : "Couldn't load this Vink's setup.",
              ),
              const SizedBox(height: VinkSpacing.md),
              VinkSecondaryButton(
                label: 'Retry',
                onPressed: () {
                  final vinkId = widget.resumeVinkId;
                  if (vinkId == null) return;
                  setState(() => _resumeError = null);
                  _loadResumeSnapshot(vinkId);
                },
              ),
            ],
          ),
        ),
      );
    }
    if (_resuming) {
      return const VinkLoadingState(message: 'Loading your Vink…');
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          VinkStepDots(stepIndex: _step.index, stepCount: 3),
          const SizedBox(height: VinkSpacing.lg),
          Expanded(
            child: switch (_step) {
              CanonicalStep.purpose => _buildPurposeStep(),
              CanonicalStep.total => _buildTotalStep(),
              CanonicalStep.peopleAndSplit => _buildPeopleAndSplitStep(),
            },
          ),
        ],
      ),
    );
  }

  Widget _buildPurposeStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const VinkStepHeader(
          title: 'What are you paying for?',
        ),
        const SizedBox(height: VinkSpacing.lg),
        VinkTextField(
          label: 'Purpose',
          controller: _purposeController,
          errorText: _purposeError,
          textInputAction: TextInputAction.next,
          onChanged: (_) {
            if (_purposeError != null) setState(() => _purposeError = null);
          },
        ),
        const SizedBox(height: VinkSpacing.lg),
        Wrap(
          spacing: VinkSpacing.sm,
          runSpacing: VinkSpacing.sm,
          children: purchaseCategories.map((category) {
            final selected = _category == category;
            return ChoiceChip(
              label: Text(purchaseCategoryLabel(category)),
              selected: selected,
              labelStyle: VinkTypography.label.copyWith(
                color: selected ? VinkColors.white : VinkColors.ink,
              ),
              selectedColor: VinkColors.blue,
              backgroundColor: VinkColors.white,
              shape: const StadiumBorder(),
              side: BorderSide(
                color: selected
                    ? VinkColors.blue
                    : VinkColors.ink.withValues(alpha: 0.12),
              ),
              onSelected: (_) {
                setState(() => _category = category);
                unawaited(_persistLocalDraftIfUnsaved());
              },
            );
          }).toList(),
        ),
        const Spacer(),
        VinkPrimaryButton(
          label: 'Continue',
          trailingIcon: Icons.arrow_forward_rounded,
          onPressed: _continueFromPurpose,
        ),
      ],
    );
  }

  Widget _buildTotalStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const VinkStepHeader(title: 'What’s the total?'),
        const Spacer(),
        Center(
          child: VinkMoneyField(
            controller: _totalController,
            autofocus: true,
            errorText: _totalError,
          ),
        ),
        const Spacer(),
        if (_error != null) ...[
          VinkInlineError(message: _error!),
          const SizedBox(height: VinkSpacing.md),
        ],
        VinkPrimaryButton(
          label: 'Continue',
          trailingIcon: Icons.arrow_forward_rounded,
          loading: _busy,
          onPressed: _createVinkAndContinue,
        ),
      ],
    );
  }

  Widget _buildPeopleAndSplitStep() {
    final included = _allParticipants;
    final preview = equalSplit(
      _requiredAmountMinor,
      included.map((p) => p.participantId).toList(),
    );
    final previewById = {
      for (final share in preview) share.participantId: share.amountMinor,
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const VinkStepHeader(
          title: 'Who\'s in, and how should everyone pay?',
          supportingText:
              'You\'re already included — add anyone else splitting this, then split it evenly or set custom amounts.',
        ),
        const SizedBox(height: VinkSpacing.md),
        Row(
          children: [
            Expanded(
              child: _SplitModeChip(
                label: 'Equal',
                selected: _splitMode == CanonicalSplitMode.equal,
                onTap: () =>
                    setState(() => _splitMode = CanonicalSplitMode.equal),
              ),
            ),
            const SizedBox(width: VinkSpacing.sm),
            Expanded(
              child: _SplitModeChip(
                label: 'Custom',
                selected: _splitMode == CanonicalSplitMode.custom,
                onTap: () =>
                    setState(() => _splitMode = CanonicalSplitMode.custom),
              ),
            ),
            // Deliberately no third "Percentage" option here (D22) — the backend supports
            // it (`setSplitCommand`'s PERCENTAGE variant) but the UI never offers it.
          ],
        ),
        const SizedBox(height: VinkSpacing.md),
        Expanded(
          child: ListView(
            children: [
              for (final person in _allParticipants)
                _buildParticipantRow(
                  person,
                  previewById[person.participantId] ?? 0,
                ),
              const SizedBox(height: VinkSpacing.sm),
              if (_people.isEmpty)
                VinkEmptyState(
                  title: 'Add the rest of your group',
                  message:
                      'Existing VinkIn members can be added by username; anyone else can join as a guest, no account needed.',
                  action: VinkSecondaryButton(
                    label: 'Add someone',
                    onPressed: _openAddPersonSheet,
                  ),
                )
              else
                Align(
                  alignment: Alignment.centerLeft,
                  child: VinkSecondaryButton(
                    label: 'Add someone',
                    onPressed: _openAddPersonSheet,
                  ),
                ),
              if (_splitMode == CanonicalSplitMode.custom) ...[
                const SizedBox(height: VinkSpacing.md),
                VinkAmountSummary(
                  totalMinor: _requiredAmountMinor,
                  assignedMinor: _customAssignedMinor(),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: VinkSpacing.md),
                VinkInlineError(message: _error!),
              ],
            ],
          ),
        ),
        const SizedBox(height: VinkSpacing.md),
        VinkPrimaryButton(
          label: 'Continue',
          loading: _busy,
          onPressed: _canContinueToConfirmation
              ? _submitSplitAndOpenConfirmation
              : null,
        ),
      ],
    );
  }

  Widget _buildParticipantRow(PersonEntry person, int equalPreviewMinor) {
    final deliveryMode = DeliveryMode.fromWireValue(person.deliveryMode);
    return Padding(
      padding: const EdgeInsets.only(bottom: VinkSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  person.isOrganizer
                      ? '${person.displayName} · You'
                      : person.displayName,
                  style: VinkTypography.body,
                  overflow: TextOverflow.ellipsis,
                ),
                // Customer-safe expectation only — never provider acceptance/attempt
                // history/diagnostics during Create (that's I7).
                if (deliveryMode != null)
                  Text(
                    deliveryMode.shortExpectation,
                    style: VinkTypography.bodySmallSecondary,
                  )
                else if (!person.isOrganizer && !person.isGuest)
                  Text('Member', style: VinkTypography.bodySmallSecondary),
              ],
            ),
          ),
          const SizedBox(width: VinkSpacing.sm),
          if (_splitMode == CanonicalSplitMode.equal)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.sm),
              child: Text(
                '\$${(equalPreviewMinor / 100).toStringAsFixed(2)}',
                style: VinkTypography.bodySmall.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            )
          else
            SizedBox(
              width: 100,
              child: TextField(
                controller: _customControllerFor(person, equalPreviewMinor),
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                textAlign: TextAlign.right,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  prefixText: '\$ ',
                  isDense: true,
                ),
              ),
            ),
          // Slice I5B (D40): draft-only correction. Never shown for the organizer's own row —
          // "the organizer remains included" is not something this screen offers to undo by
          // removing them as a participant (that stays permanently unavailable, matching the
          // unchanged `removeParticipantCommand` guard); a guest additionally gets an edit
          // affordance (display name/delivery mode/destination), a member does not (nothing
          // client-editable exists for a member — their delivery is account-driven, I4).
          if (!person.isOrganizer) ...[
            if (person.isGuest)
              IconButton(
                icon: const Icon(
                  Icons.edit_outlined,
                  size: 18,
                  color: VinkColors.smoke,
                ),
                tooltip: 'Edit guest',
                onPressed: () => _openEditGuestSheet(person),
              ),
            IconButton(
              icon: const Icon(
                Icons.delete_outline_rounded,
                size: 18,
                color: VinkColors.smoke,
              ),
              tooltip: 'Remove',
              onPressed: () => _removeParticipant(person),
            ),
          ],
        ],
      ),
    );
  }
}

class _SplitModeChip extends StatelessWidget {
  const _SplitModeChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

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
            border: Border.all(
              color: selected
                  ? VinkColors.blue
                  : VinkColors.ink.withValues(alpha: 0.12),
            ),
          ),
          child: Text(
            label,
            style: VinkTypography.label.copyWith(
              color: selected ? VinkColors.white : VinkColors.ink,
            ),
          ),
        ),
      ),
    );
  }
}
