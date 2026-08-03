import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import '../../../core/auth/auth_controller.dart';
import '../../../core/errors/api_exception.dart';
import '../../../core/errors/failure_classifier.dart';
import '../../../core/networking/idempotency_key.dart';
import '../../../design_system/components/vink_buttons.dart';
import '../../../design_system/components/vink_inline_error.dart';
import '../../../design_system/components/vink_text_field.dart';
import '../../../design_system/vink_colors.dart';
import '../../../design_system/vink_spacing.dart';
import '../../../design_system/vink_typography.dart';
import '../person_entry.dart';
import 'delivery_mode.dart';

enum _Phase {
  username,
  notFound,
  guestDetails,
  guestManualReady, // manual mode: show the QR/link, exactly like the five-step wizard
  guestDispatchConfirmed, // sms/email mode: customer-safe expectation only, no diagnostics
}

/// Slice I5 — the canonical flow's "Add/Edit participant" sheet (Phase 4 §5b, Phase 5 C8):
/// same member-lookup-with-guest-fallback shape as the five-step wizard's `AddPersonSheet`
/// (not modified — this is a distinct file so the old flow's own behavior/tests stay
/// untouched), extended with the delivery-mode capture I4B's API now supports. A known
/// member never sees a delivery-mode choice at all: their automatic delivery already uses
/// their own account contact info (I4), captured at registration/profile, never chosen here.
class CanonicalAddPersonSheet extends ConsumerStatefulWidget {
  const CanonicalAddPersonSheet({super.key, required this.vinkId});

  final String vinkId;

  @override
  ConsumerState<CanonicalAddPersonSheet> createState() =>
      _CanonicalAddPersonSheetState();
}

class _CanonicalAddPersonSheetState
    extends ConsumerState<CanonicalAddPersonSheet> {
  _Phase _phase = _Phase.username;
  final _usernameController = TextEditingController();
  final _guestNameController = TextEditingController();
  final _destinationController = TextEditingController();
  DeliveryMode _deliveryMode =
      DeliveryMode.manual; // never inferred — an explicit default
  bool _busy = false;
  String? _error;
  String? _destinationError;
  String? _lastTriedUsername;
  PersonEntry? _readyGuest;

  // ENG1 #4 pattern, unchanged: generated lazily on the first "Add guest" attempt and reused
  // across retries of that same attempt.
  String? _guestInviteIdempotencyKey;

  @override
  void dispose() {
    _usernameController.dispose();
    _guestNameController.dispose();
    _destinationController.dispose();
    super.dispose();
  }

  Future<void> _lookupAndAdd() async {
    final username = _usernameController.text.trim();
    if (username.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final client = ref.read(apiClientProvider);
      final participant = await client.post(
        '/api/v1/vinks/${widget.vinkId}/participants',
        body: {'username': username},
      );
      if (!mounted) return;
      Navigator.of(context).pop(
        PersonEntry(
          participantId: participant['id'] as String,
          displayName: participant['displayName'] as String,
          isGuest: false,
          isOrganizer: false,
        ),
      );
    } on ApiException catch (error) {
      if (error.code == 'USER_NOT_FOUND') {
        setState(() {
          _lastTriedUsername = username;
          _phase = _Phase.notFound;
        });
        return;
      }
      final failure = classifyFailure(error);
      if (failure.category == FailureCategory.alreadyCompleted) {
        // ENG1 #4 / duplicate-participant prevention: already a participant — a lost-
        // response retry catching up with reality, not a failure. Close quietly; the
        // People+Split screen's own state already reflects who's really in.
        if (mounted) Navigator.of(context).pop();
        return;
      }
      setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  bool get _canSubmitGuestDetails {
    if (_guestNameController.text.trim().isEmpty) return false;
    if (_deliveryMode == DeliveryMode.manual) return true;
    return validateContactDestination(
          _deliveryMode,
          _destinationController.text,
        ) ==
        null;
  }

  Future<void> _addAsGuest() async {
    final displayName = _guestNameController.text.trim();
    if (displayName.isEmpty) return;
    final destination = _destinationController.text.trim();
    final destinationError = validateContactDestination(
      _deliveryMode,
      destination,
    );
    if (destinationError != null) {
      setState(() => _destinationError = destinationError);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _destinationError = null;
    });
    try {
      final client = ref.read(apiClientProvider);
      _guestInviteIdempotencyKey ??= newIdempotencyKey();
      final response = await client.post(
        '/api/v1/vinks/${widget.vinkId}/guests',
        body: {
          'displayName': displayName,
          'deliveryMode': _deliveryMode.wireValue,
          if (_deliveryMode != DeliveryMode.manual)
            'contactDestination': destination,
          'invitationIdempotencyKey': _guestInviteIdempotencyKey,
        },
      );
      final participant = response['participant'] as Map<String, dynamic>;
      final guest = PersonEntry(
        participantId: participant['id'] as String,
        displayName: participant['displayName'] as String,
        isGuest: true,
        isOrganizer: false,
        guestJoinUrl: response['joinUrl'] as String?,
        deliveryMode: _deliveryMode.wireValueUppercase,
        contactDestination: _deliveryMode == DeliveryMode.manual
            ? null
            : destination,
      );
      setState(() {
        _readyGuest = guest;
        // Manual mode still gets the QR/link (I4-compatible, nothing changed there). SMS/
        // EMAIL mode's token doesn't exist yet (I4B: minted only at dispatch time, VINK_OPENED)
        // — there is no link to show, and showing provider/attempt diagnostics here is
        // explicitly out of scope for Create (I7's job), so this phase is a plain
        // customer-safe confirmation only.
        _phase = _deliveryMode == DeliveryMode.manual
            ? _Phase.guestManualReady
            : _Phase.guestDispatchConfirmed;
      });
    } on ApiException catch (error) {
      final failure = classifyFailure(error);
      if (failure.category == FailureCategory.alreadyCompleted) {
        // The raw join link (manual mode) can't be recovered either way (D14) — closing
        // quietly is correct: no duplicate guest was created, which is what matters.
        if (mounted) Navigator.of(context).pop();
        return;
      }
      setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return switch (_phase) {
      _Phase.username => _buildUsernamePhase(),
      _Phase.notFound => _buildNotFoundPhase(),
      _Phase.guestDetails => _buildGuestDetailsPhase(),
      _Phase.guestManualReady => _buildGuestManualReadyPhase(),
      _Phase.guestDispatchConfirmed => _buildGuestDispatchConfirmedPhase(),
    };
  }

  Widget _buildUsernamePhase() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Add someone', style: VinkTypography.title),
        const SizedBox(height: VinkSpacing.xs),
        Text(
          'Enter their VinkIn username.',
          style: VinkTypography.bodySecondary,
        ),
        const SizedBox(height: VinkSpacing.lg),
        VinkTextField(
          label: 'Username',
          controller: _usernameController,
          autofocus: true,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _lookupAndAdd(),
        ),
        if (_error != null) ...[
          const SizedBox(height: VinkSpacing.sm),
          VinkInlineError(message: _error!),
        ],
        const SizedBox(height: VinkSpacing.lg),
        VinkPrimaryButton(
          label: 'Add',
          loading: _busy,
          onPressed: _lookupAndAdd,
        ),
      ],
    );
  }

  Widget _buildNotFoundPhase() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('No VinkIn account yet', style: VinkTypography.title),
        const SizedBox(height: VinkSpacing.xs),
        Text(
          'We couldn\'t find "@$_lastTriedUsername." That\'s okay — you can add them as a guest instead.',
          style: VinkTypography.bodySecondary,
        ),
        const SizedBox(height: VinkSpacing.lg),
        VinkPrimaryButton(
          label: 'Add as guest',
          onPressed: () {
            _guestNameController.text = _lastTriedUsername ?? '';
            setState(() {
              _phase = _Phase.guestDetails;
              _error = null;
            });
          },
        ),
        const SizedBox(height: VinkSpacing.sm),
        VinkTextButton(
          label: 'Try another username',
          onPressed: () {
            _usernameController.clear();
            setState(() {
              _phase = _Phase.username;
              _error = null;
            });
          },
        ),
      ],
    );
  }

  Widget _buildGuestDetailsPhase() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Add as guest', style: VinkTypography.title),
        const SizedBox(height: VinkSpacing.xs),
        Text(
          'No account needed — just a name and how to reach them.',
          style: VinkTypography.bodySecondary,
        ),
        const SizedBox(height: VinkSpacing.lg),
        // Display name stays a distinct field from the contact destination below — never
        // pre-filled from a phone/email, never used as a fallback destination.
        VinkTextField(
          label: 'Display name',
          controller: _guestNameController,
          autofocus: true,
          textInputAction: TextInputAction.next,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: VinkSpacing.lg),
        Text('How should we let them know?', style: VinkTypography.label),
        const SizedBox(height: VinkSpacing.sm),
        Wrap(
          spacing: VinkSpacing.sm,
          runSpacing: VinkSpacing.sm,
          children: DeliveryMode.values.map((mode) {
            final selected = _deliveryMode == mode;
            return ChoiceChip(
              label: Text(mode.label),
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
              onSelected: (_) => setState(() {
                _deliveryMode = mode;
                _destinationError = null;
              }),
            );
          }).toList(),
        ),
        const SizedBox(height: VinkSpacing.sm),
        Text(
          _deliveryMode.expectationCaption,
          style: VinkTypography.bodySmallSecondary,
        ),
        if (_deliveryMode != DeliveryMode.manual) ...[
          const SizedBox(height: VinkSpacing.md),
          VinkTextField(
            label: _deliveryMode == DeliveryMode.sms
                ? 'Phone number'
                : 'Email address',
            controller: _destinationController,
            keyboardType: _deliveryMode == DeliveryMode.sms
                ? TextInputType.phone
                : TextInputType.emailAddress,
            autofillHints: [
              _deliveryMode == DeliveryMode.sms
                  ? AutofillHints.telephoneNumber
                  : AutofillHints.email,
            ],
            textInputAction: TextInputAction.done,
            errorText: _destinationError,
            onChanged: (_) => setState(() => _destinationError = null),
            onSubmitted: (_) => _addAsGuest(),
          ),
        ],
        if (_error != null) ...[
          const SizedBox(height: VinkSpacing.sm),
          VinkInlineError(message: _error!),
        ],
        const SizedBox(height: VinkSpacing.lg),
        VinkPrimaryButton(
          label: 'Add guest',
          loading: _busy,
          onPressed: _canSubmitGuestDetails ? _addAsGuest : null,
        ),
        const SizedBox(height: VinkSpacing.sm),
        VinkTextButton(
          label: 'Back',
          onPressed: () => setState(() => _phase = _Phase.notFound),
        ),
      ],
    );
  }

  Widget _buildGuestManualReadyPhase() {
    final guest = _readyGuest!;
    final link = guest.guestJoinUrl!;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('${guest.displayName} is in', style: VinkTypography.title),
        const SizedBox(height: VinkSpacing.xs),
        Text(
          'Send them this link so they can join and pay their share — no account needed.',
          style: VinkTypography.bodySecondary,
        ),
        const SizedBox(height: VinkSpacing.lg),
        Center(
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: VinkColors.white,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Padding(
              padding: const EdgeInsets.all(VinkSpacing.md),
              child: QrImageView(
                data: link,
                size: 160,
                backgroundColor: VinkColors.white,
              ),
            ),
          ),
        ),
        const SizedBox(height: VinkSpacing.md),
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: VinkSpacing.md,
            vertical: VinkSpacing.sm + 2,
          ),
          decoration: BoxDecoration(
            color: VinkColors.ink.withValues(alpha: 0.04),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            link,
            style: VinkTypography.bodySmall,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        const SizedBox(height: VinkSpacing.md),
        Row(
          children: [
            Expanded(
              child: VinkSecondaryButton(
                label: 'Copy link',
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: link));
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Link copied.')),
                    );
                  }
                },
              ),
            ),
            const SizedBox(width: VinkSpacing.sm),
            Expanded(
              child: VinkSecondaryButton(
                label: 'Share',
                onPressed: () => Share.share(link),
              ),
            ),
          ],
        ),
        const SizedBox(height: VinkSpacing.md),
        VinkPrimaryButton(
          label: 'Done',
          onPressed: () => Navigator.of(context).pop(guest),
        ),
      ],
    );
  }

  Widget _buildGuestDispatchConfirmedPhase() {
    final guest = _readyGuest!;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('${guest.displayName} is in', style: VinkTypography.title),
        const SizedBox(height: VinkSpacing.xs),
        // Customer-safe expectation only — no provider acceptance, attempt history, or
        // delivery diagnostics during Create (explicitly deferred to I7).
        Text(
          _deliveryMode.expectationCaption,
          style: VinkTypography.bodySecondary,
        ),
        const SizedBox(height: VinkSpacing.lg),
        VinkPrimaryButton(
          label: 'Done',
          onPressed: () => Navigator.of(context).pop(guest),
        ),
      ],
    );
  }
}
