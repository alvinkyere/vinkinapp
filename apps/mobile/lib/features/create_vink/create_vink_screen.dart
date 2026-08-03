import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/analytics/analytics.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/errors/api_exception.dart';
import '../../core/errors/failure_classifier.dart';
import '../../core/errors/failure_handling.dart';
import '../../core/errors/human_errors.dart';
import '../../core/models/vink.dart';
import '../../core/networking/idempotency_key.dart';
import '../../core/split/split_calculator.dart';
import '../../design_system/components/money_text.dart';
import '../../design_system/components/vink_amount_summary.dart';
import '../../design_system/components/vink_bottom_sheet.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_empty_state.dart';
import '../../design_system/components/vink_inline_error.dart';
import '../../design_system/components/vink_numeric_keypad.dart';
import '../../design_system/components/vink_participant_row.dart';
import '../../design_system/components/vink_step_header.dart';
import '../../design_system/components/vink_surface_card.dart';
import '../../design_system/components/vink_text_field.dart';
import '../../design_system/vink_colors.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';
import '../home/home_providers.dart';
import 'add_person_sheet.dart';
import 'local_draft_store.dart';
import 'person_entry.dart';
import 'purchase_category.dart';

const _stepPurpose = 0;
const _stepTotal = 1;
const _stepPeople = 2;
const _stepSplit = 3;
const _stepReview = 4;
const _stepCount = 5;

/// ENG1 #5 setup recovery: which step a server-persisted DRAFT Vink's setup should resume
/// at, decided purely from the server's own current state — mirrors
/// `computeAllowedActions` (packages/application/src/queries.ts) rather than re-deriving its
/// own notion of "how far along is this Vink." A persisted DRAFT vink always already has a
/// category and total (the backend requires both to create one), so Purpose/Total are never
/// a resume destination — only Add people, Split, or Review are reachable.
int resumeStepFor(VinkSnapshot snapshot, {required bool hasOtherParticipants}) {
  if (!hasOtherParticipants) return _stepPeople;
  if (snapshot.unallocatedAmountMinor > 0) return _stepSplit;
  return _stepReview;
}

enum _SplitMode { equal, custom }

/// The five-step create-Vink flow (design correction milestone): Purpose → Total → Add
/// people → Split → Review. The vink itself is created on the network only once Purpose
/// and Total are both chosen (the backend's `createSchema` requires both together) — steps
/// 0–1 are local-only, everything from step 2 onward mutates the real DRAFT vink.
///
/// ENG1 Slice 3 (setup recovery): the app never relies on the "Draft" UI label to define
/// recovery. A server-persisted DRAFT vink is resumed here at its exact valid step
/// ([resumeVinkId] — routed to by the Home screen's Active Vinks card and by
/// `VinkLobbyScreen`'s own DRAFT redirect, so any path that lands on a DRAFT vink converges
/// here); an unsaved pre-network local form (Purpose/Total only) is durably persisted and
/// offered back as a resume-or-discard choice on the next launch, not silently lost.
class CreateVinkScreen extends ConsumerStatefulWidget {
  const CreateVinkScreen({super.key, this.resumeVinkId});

  /// Set only when navigating here to resume an existing server-persisted DRAFT Vink —
  /// distinct from a plain `/create-vink` visit, which always starts a genuinely new one.
  final String? resumeVinkId;

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

  // Generated lazily on the first submit attempt and reused across retries of that SAME
  // attempt (ENG1 #4) — a lost-response retry replays the original Vink instead of creating
  // a duplicate. A fresh screen instance (a genuinely new attempt) gets a fresh key.
  String? _createIdempotencyKey;

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

  // ENG1 #5 setup recovery
  final _localDraftStore = LocalDraftStore();
  bool _resuming =
      false; // true while fetching the snapshot for widget.resumeVinkId
  Object? _resumeError;

  Analytics get _analytics => ref.read(analyticsProvider);

  @override
  void initState() {
    super.initState();
    _totalController.addListener(_persistLocalDraftIfUnsaved);
    final resumeVinkId = widget.resumeVinkId;
    if (resumeVinkId != null) {
      _loadResumeSnapshot(resumeVinkId);
    } else {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _offerLocalDraftIfAny(),
      );
    }
  }

  /// Fetches the server's own current state for [vinkId] and lands on the step that state
  /// actually calls for — never assumed from how the user got here. Mirrors
  /// `computeAllowedActions` (packages/application/src/queries.ts): no other participant yet
  /// → Add people; participants exist but the split isn't complete (`unallocatedAmountMinor`
  /// > 0) → Split; otherwise (`OPEN_VINK` allowed) → Review, pre-populated exactly as
  /// `_submitSplitAndReview` would have left it.
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
                // Not recoverable on resume by design (D14): the raw guest link is returned
                // exactly once, at invite time, and only its hash is ever stored thereafter.
                guestJoinUrl: null,
              ),
            ),
          );
        _step = resumeStepFor(
          snapshot,
          hasOtherParticipants: others.isNotEmpty,
        );
        if (_step == _stepReview) _reviewSnapshot = snapshot;
        _resuming = false;
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _resumeError = error);
    }
  }

  Future<void> _persistLocalDraftIfUnsaved() async {
    if (_vinkId != null) return; // the server is authoritative from here on
    await _localDraftStore.save(
      UnsavedDraft(category: _category, totalText: _totalController.text),
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
        _step = _stepTotal;
      });
    } else {
      await _localDraftStore.clear();
    }
  }

  @override
  void dispose() {
    _totalController.removeListener(_persistLocalDraftIfUnsaved);
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

  List<PersonEntry> get _allParticipants => [
    if (_organizer != null) _organizer!,
    ..._people,
  ];

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
      final displayName = authState is AuthSignedIn
          ? authState.user.displayName
          : 'Organizer';
      _createIdempotencyKey ??= newIdempotencyKey();
      // ENG1 timer semantics: the app never re-derives backend logic (Plan §19) — that used
      // to include this hardcoded `now + 24h`, exactly the kind of "accidentally hard-coded"
      // client-side timing decision ENG1 flags. The server now owns how long a Vink stays
      // open (VINK_OPEN_DURATION_SECONDS); omitting submissionDeadline defers to it.
      final response = await client.post(
        '/api/v1/vinks',
        body: {
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
      // The Vink now exists server-side — it's the authoritative record of this setup from
      // here on (Home's Active Vinks + resume-by-vinkId), so the pre-network local draft no
      // longer serves a purpose. Cleared even if the app is killed right after this line:
      // relaunch finds the real DRAFT vink via Home, not a stale local draft prompt.
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
        _step = _stepPeople;
      });
    } on ApiException catch (error) {
      _analytics.track('create_vink_failed', {'errorCode': error.code});
      setState(() => _error = presentFailure(ref, error).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openAddPersonSheet() async {
    final vinkId = _vinkId;
    if (vinkId == null) return;
    final added = await showVinkBottomSheet<PersonEntry>(
      context: context,
      builder: (_) => AddPersonSheet(vinkId: vinkId),
    );
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
      setState(
        () => _error = 'Add at least one other person before continuing.',
      );
      return;
    }
    setState(() {
      _error = null;
      _step = _stepSplit;
    });
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
        await client.put(
          '/api/v1/vinks/$vinkId/split',
          body: {'method': 'EQUAL'},
        );
      } else if (_splitMode == _SplitMode.equal) {
        // Organizer excluded: EQUAL would still include them (it covers every active
        // participant), so an intentional $0 for the organizer has to go through
        // CUSTOM_AMOUNT instead — never a silent zero, always this explicit toggle's result.
        final others = _people.map((p) => p.participantId).toList();
        final shares = equalSplit(_requiredAmountMinor, others);
        final amounts = [
          {'participantId': _organizer!.participantId, 'amountMinor': 0},
          for (final share in shares)
            {
              'participantId': share.participantId,
              'amountMinor': share.amountMinor,
            },
        ];
        await client.put(
          '/api/v1/vinks/$vinkId/split',
          body: {'method': 'CUSTOM_AMOUNT', 'amounts': amounts},
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
      final snapshot = await client.get('/api/v1/vinks/$vinkId');
      _analytics.track('split_applied', {
        'method': _splitMode.name,
        'participantCount': _allParticipants.length,
      }, vinkId);
      setState(() {
        _reviewSnapshot = VinkSnapshot.fromJson(snapshot);
        _step = _stepReview;
      });
    } on ApiException catch (error) {
      _analytics.track('split_failed', {'errorCode': error.code}, vinkId);
      setState(() => _error = presentFailure(ref, error).message);
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
      final failure = presentFailure(ref, error);
      if (failure.category == FailureCategory.conflict) {
        // ENG1 #4: a double tap, or an earlier "Open" attempt that actually succeeded but
        // whose response was lost. `open` is a one-way DRAFT → OPEN transition (packages/
        // domain/src/vink-state-machine.ts) — if the vink is no longer DRAFT, it's already
        // open, and the right response to a duplicate tap is to proceed exactly as if this
        // one had succeeded too, not show an error for something that already worked.
        try {
          final snapshot = await ref
              .read(apiClientProvider)
              .get('/api/v1/vinks/$vinkId');
          if (VinkSnapshot.fromJson(snapshot).vink.state != 'DRAFT') {
            ref.invalidate(myVinksProvider);
            if (mounted) context.go('/vinks/$vinkId');
            return;
          }
        } on ApiException {
          // Fall through to the normal error path below.
        }
      }
      setState(() => _error = failure.message);
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
    );
  }

  Widget _buildPurposeStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const VinkStepHeader(
          title: 'What\'s this Vink for?',
          supportingText: 'Pick the closest category.',
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
          onPressed: () => setState(() => _step = _stepTotal),
        ),
      ],
    );
  }

  Widget _buildTotalStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const VinkStepHeader(
          title: 'What\'s the total?',
          supportingText: 'The full amount everyone will split.',
        ),
        const SizedBox(height: VinkSpacing.xxl),
        Center(
          child: VinkMoneyField(
            controller: _totalController,
            autofocus: true,
            errorText: _totalError,
          ),
        ),
        const SizedBox(height: VinkSpacing.xxl),
        // Concept-image in-app keypad — additive alongside the OS keyboard the field already
        // supports (autofocus above still opens it); this is a visual, tappable alternative,
        // not a replacement.
        VinkNumericKeypad(
          controller: _totalController,
          onChanged: (_) => setState(() {}),
        ),
        const Spacer(),
        if (_error != null) ...[
          VinkInlineError(message: _error!),
          const SizedBox(height: VinkSpacing.md),
        ],
        Row(
          children: [
            Expanded(
              child: VinkSecondaryButton(
                label: 'Back',
                onPressed: () => setState(() => _step = _stepPurpose),
              ),
            ),
            const SizedBox(width: VinkSpacing.sm),
            Expanded(
              child: VinkPrimaryButton(
                label: 'Continue',
                trailingIcon: Icons.arrow_forward_rounded,
                loading: _busy,
                onPressed: _createVinkAndContinue,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildPeopleStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const VinkStepHeader(
          title: 'Who\'s in?',
          supportingText:
              'You\'re already included — add anyone else splitting this.',
        ),
        const SizedBox(height: VinkSpacing.lg),
        Expanded(
          child: ListView(
            children: [
              if (_organizer != null)
                VinkSurfaceCard(
                  padding: const EdgeInsets.symmetric(
                    horizontal: VinkSpacing.md,
                    vertical: VinkSpacing.sm,
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${_organizer!.displayName} · You',
                          style: VinkTypography.participantName,
                        ),
                      ),
                      Switch(
                        value: _includeOrganizer,
                        activeThumbColor: VinkColors.blue,
                        onChanged: (value) =>
                            setState(() => _includeOrganizer = value),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: VinkSpacing.xs),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.sm),
                child: Text(
                  _includeOrganizer
                      ? 'Include me in this Vink'
                      : 'Not paying a share of this Vink',
                  style: VinkTypography.bodySmallSecondary,
                ),
              ),
              const SizedBox(height: VinkSpacing.lg),
              for (final person in _people) ...[
                VinkSurfaceCard(
                  padding: const EdgeInsets.symmetric(
                    horizontal: VinkSpacing.md,
                    vertical: VinkSpacing.sm,
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          person.displayName,
                          style: VinkTypography.participantName,
                        ),
                      ),
                      Text(
                        person.isGuest ? 'Guest' : 'Member',
                        style: VinkTypography.bodySmallSecondary,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: VinkSpacing.sm),
              ],
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
          trailingIcon: Icons.arrow_forward_rounded,
          onPressed: _goToSplit,
        ),
      ],
    );
  }

  Widget _buildSplitStep() {
    final included = _financiallyIncluded;
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
          title: 'How should everyone pay?',
          supportingText: 'Split it evenly, or set custom amounts.',
        ),
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
                        roleLabel: person.isOrganizer
                            ? 'Organizer'
                            : (person.isGuest ? 'Guest' : null),
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
                                person.isOrganizer
                                    ? '${person.displayName} · You'
                                    : person.displayName,
                                style: VinkTypography.body,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const SizedBox(width: VinkSpacing.sm),
                            Expanded(
                              child: TextField(
                                controller: _customControllerFor(
                                  person,
                                  previewById[person.participantId] ?? 0,
                                ),
                                keyboardType:
                                    const TextInputType.numberWithOptions(
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
                          ],
                        ),
                      ),
                    const SizedBox(height: VinkSpacing.md),
                    VinkAmountSummary(
                      totalMinor: _requiredAmountMinor,
                      assignedMinor: _customAssignedMinor(),
                    ),
                  ],
                ),
        ),
        if (_error != null) ...[
          const SizedBox(height: VinkSpacing.sm),
          VinkInlineError(message: _error!),
        ],
        const SizedBox(height: VinkSpacing.md),
        Row(
          children: [
            Expanded(
              child: VinkSecondaryButton(
                label: 'Back',
                onPressed: () => setState(() => _step = _stepPeople),
              ),
            ),
            const SizedBox(width: VinkSpacing.sm),
            Expanded(
              child: VinkPrimaryButton(
                label: 'Continue',
                loading: _busy,
                onPressed:
                    (_splitMode == _SplitMode.custom &&
                        _customAssignedMinor() != _requiredAmountMinor)
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
                        Text(
                          purchaseCategoryLabel(snapshot.vink.purchaseCategory),
                          style: VinkTypography.cardTitle,
                        ),
                        MoneyText(
                          snapshot.vink.requiredAmountMinor,
                          style: VinkTypography.amountMedium,
                        ),
                      ],
                    ),
                    const SizedBox(height: VinkSpacing.md),
                    for (final participant in snapshot.participants)
                      VinkParticipantRow(
                        name: participant.displayName,
                        amountMinor: participant.allocatedAmountMinor,
                        paymentState: VinkParticipantPaymentState.waiting,
                        isSelf: participant.isOrganizer,
                        roleLabel: participant.isOrganizer
                            ? 'Organizer'
                            : (participant.isGuest ? 'Guest' : null),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: VinkSpacing.md),
              Row(
                children: [
                  Expanded(
                    child: VinkTextButton(
                      label: 'Edit people',
                      onPressed: () => setState(() => _step = _stepPeople),
                    ),
                  ),
                  Expanded(
                    child: VinkTextButton(
                      label: 'Edit split',
                      onPressed: () => setState(() => _step = _stepSplit),
                    ),
                  ),
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: VinkSpacing.sm),
                VinkInlineError(message: _error!),
              ],
            ],
          ),
        ),
        const SizedBox(height: VinkSpacing.md),
        VinkPrimaryButton(
          label: 'Open Vink',
          trailingIcon: Icons.arrow_forward_rounded,
          glow: true,
          loading: _busy,
          onPressed: _openVink,
        ),
      ],
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
