import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/auth/auth_controller.dart';
import '../../../core/errors/api_exception.dart';
import '../../../core/errors/failure_classifier.dart';
import '../../../design_system/components/vink_buttons.dart';
import '../../../design_system/components/vink_inline_error.dart';
import '../../../design_system/components/vink_text_field.dart';
import '../../../design_system/vink_colors.dart';
import '../../../design_system/vink_spacing.dart';
import '../../../design_system/vink_typography.dart';
import '../person_entry.dart';
import 'delivery_mode.dart';

/// Slice I5B (D40) — draft-only guest correction: display name, delivery mode, and contact
/// destination, via `PATCH /vinks/:vinkId/participants/:participantId/guest`. Every field is
/// resent on save (matching the backend's own `editGuestSchema` shape — no ambiguity about
/// what "unchanged" means for an omitted field). Members have nothing editable here at all —
/// this sheet is guest-only, matching D40's own "editable guest fields" list; a member's own
/// row only ever gets a remove action (`canonical_create_vink_screen.dart`).
class CanonicalEditGuestSheet extends ConsumerStatefulWidget {
  const CanonicalEditGuestSheet({super.key, required this.vinkId, required this.person});

  final String vinkId;
  final PersonEntry person;

  @override
  ConsumerState<CanonicalEditGuestSheet> createState() => _CanonicalEditGuestSheetState();
}

class _CanonicalEditGuestSheetState extends ConsumerState<CanonicalEditGuestSheet> {
  late final _nameController = TextEditingController(text: widget.person.displayName);
  late final _destinationController = TextEditingController(text: widget.person.contactDestination ?? '');
  late DeliveryMode _deliveryMode =
      DeliveryMode.fromWireValue(widget.person.deliveryMode) ?? DeliveryMode.manual;
  bool _busy = false;
  String? _error;
  String? _destinationError;

  @override
  void dispose() {
    _nameController.dispose();
    _destinationController.dispose();
    super.dispose();
  }

  bool get _canSave {
    if (_nameController.text.trim().isEmpty) return false;
    if (_deliveryMode == DeliveryMode.manual) return true;
    return validateContactDestination(_deliveryMode, _destinationController.text) == null;
  }

  Future<void> _save() async {
    final displayName = _nameController.text.trim();
    final destination = _destinationController.text.trim();
    if (_deliveryMode != DeliveryMode.manual) {
      final destinationError = validateContactDestination(_deliveryMode, destination);
      if (destinationError != null) {
        setState(() => _destinationError = destinationError);
        return;
      }
    }
    setState(() {
      _busy = true;
      _error = null;
      _destinationError = null;
    });
    try {
      final client = ref.read(apiClientProvider);
      final response = await client.patch(
        '/api/v1/vinks/${widget.vinkId}/participants/${widget.person.participantId}/guest',
        body: {
          'displayName': displayName,
          'deliveryMode': _deliveryMode.wireValue,
          if (_deliveryMode != DeliveryMode.manual) 'contactDestination': destination,
        },
      );
      final participant = response['participant'] as Map<String, dynamic>;
      if (!mounted) return;
      Navigator.of(context).pop(
        PersonEntry(
          participantId: participant['id'] as String,
          displayName: participant['displayName'] as String,
          isGuest: true,
          isOrganizer: false,
          guestJoinUrl: response['joinUrl'] as String?,
          deliveryMode: _deliveryMode.wireValueUppercase,
          contactDestination: _deliveryMode == DeliveryMode.manual ? null : destination,
        ),
      );
    } on ApiException catch (error) {
      setState(() => _error = classifyFailure(error).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Edit guest', style: VinkTypography.title),
        const SizedBox(height: VinkSpacing.lg),
        VinkTextField(
          label: 'Display name',
          controller: _nameController,
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
              labelStyle: VinkTypography.label.copyWith(color: selected ? VinkColors.white : VinkColors.ink),
              selectedColor: VinkColors.blue,
              backgroundColor: VinkColors.white,
              shape: const StadiumBorder(),
              side: BorderSide(color: selected ? VinkColors.blue : VinkColors.ink.withValues(alpha: 0.12)),
              onSelected: (_) => setState(() {
                _deliveryMode = mode;
                _destinationError = null;
              }),
            );
          }).toList(),
        ),
        const SizedBox(height: VinkSpacing.sm),
        Text(_deliveryMode.expectationCaption, style: VinkTypography.bodySmallSecondary),
        if (_deliveryMode != DeliveryMode.manual) ...[
          const SizedBox(height: VinkSpacing.md),
          VinkTextField(
            label: _deliveryMode == DeliveryMode.sms ? 'Phone number' : 'Email address',
            controller: _destinationController,
            keyboardType: _deliveryMode == DeliveryMode.sms
                ? TextInputType.phone
                : TextInputType.emailAddress,
            errorText: _destinationError,
            onChanged: (_) => setState(() => _destinationError = null),
            onSubmitted: (_) => _save(),
          ),
        ],
        if (_error != null) ...[const SizedBox(height: VinkSpacing.sm), VinkInlineError(message: _error!)],
        const SizedBox(height: VinkSpacing.lg),
        VinkPrimaryButton(label: 'Save', loading: _busy, onPressed: _canSave ? _save : null),
      ],
    );
  }
}
