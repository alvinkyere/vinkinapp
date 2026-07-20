import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/errors/api_exception.dart';
import '../../design_system/components/vink_buttons.dart';
import '../../design_system/components/vink_inline_error.dart';
import '../../design_system/components/vink_text_field.dart';
import '../../design_system/vink_colors.dart';
import '../../design_system/vink_spacing.dart';
import '../../design_system/vink_typography.dart';
import 'person_entry.dart';

enum _Phase { username, notFound, guestName, guestReady }

/// The "Add someone" sheet (create-Vink step 3): look up a username first; an unknown
/// username is never a dead end — it offers "Add as guest" right there, in the same sheet,
/// with no account required for the guest (D14 token-based identity, PV13 organizer-invite
/// extension — packages/application/src/guest.ts `inviteGuestCommand`).
class AddPersonSheet extends ConsumerStatefulWidget {
  const AddPersonSheet({super.key, required this.vinkId});

  final String vinkId;

  @override
  ConsumerState<AddPersonSheet> createState() => _AddPersonSheetState();
}

class _AddPersonSheetState extends ConsumerState<AddPersonSheet> {
  _Phase _phase = _Phase.username;
  final _usernameController = TextEditingController();
  final _guestNameController = TextEditingController();
  bool _busy = false;
  String? _error;
  String? _lastTriedUsername;
  PersonEntry? _readyGuest;

  @override
  void dispose() {
    _usernameController.dispose();
    _guestNameController.dispose();
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
      final participant = await client.post('/api/v1/vinks/${widget.vinkId}/participants', body: {'username': username});
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
      } else {
        setState(() => _error = "Something went wrong. Try again.");
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addAsGuest() async {
    final displayName = _guestNameController.text.trim();
    if (displayName.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final client = ref.read(apiClientProvider);
      final response = await client.post('/api/v1/vinks/${widget.vinkId}/guests', body: {'displayName': displayName});
      final participant = response['participant'] as Map<String, dynamic>;
      setState(() {
        _readyGuest = PersonEntry(
          participantId: participant['id'] as String,
          displayName: participant['displayName'] as String,
          isGuest: true,
          isOrganizer: false,
          guestJoinUrl: response['joinUrl'] as String,
        );
        _phase = _Phase.guestReady;
      });
    } on ApiException {
      setState(() => _error = "Couldn't add them as a guest. Try again.");
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return switch (_phase) {
      _Phase.username => _buildUsernamePhase(),
      _Phase.notFound => _buildNotFoundPhase(),
      _Phase.guestName => _buildGuestNamePhase(),
      _Phase.guestReady => _buildGuestReadyPhase(),
    };
  }

  Widget _buildUsernamePhase() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Add someone', style: VinkTypography.title),
        const SizedBox(height: VinkSpacing.xs),
        Text('Enter their VinkIn username.', style: VinkTypography.bodySecondary),
        const SizedBox(height: VinkSpacing.lg),
        VinkTextField(
          label: 'Username',
          controller: _usernameController,
          autofocus: true,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _lookupAndAdd(),
        ),
        if (_error != null) ...[const SizedBox(height: VinkSpacing.sm), VinkInlineError(message: _error!)],
        const SizedBox(height: VinkSpacing.lg),
        VinkPrimaryButton(label: 'Add', loading: _busy, onPressed: _lookupAndAdd),
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
          'We couldn\'t find "@$_lastTriedUsername." That\'s okay — you can add them as a guest instead. '
          'They\'ll get a link to join and pay their share, no account needed.',
          style: VinkTypography.bodySecondary,
        ),
        const SizedBox(height: VinkSpacing.lg),
        VinkPrimaryButton(
          label: 'Add as guest',
          onPressed: () {
            _guestNameController.text = _lastTriedUsername ?? '';
            setState(() {
              _phase = _Phase.guestName;
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

  Widget _buildGuestNamePhase() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Add as guest', style: VinkTypography.title),
        const SizedBox(height: VinkSpacing.xs),
        Text('What should we call them?', style: VinkTypography.bodySecondary),
        const SizedBox(height: VinkSpacing.lg),
        VinkTextField(
          label: 'Display name',
          controller: _guestNameController,
          autofocus: true,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _addAsGuest(),
        ),
        if (_error != null) ...[const SizedBox(height: VinkSpacing.sm), VinkInlineError(message: _error!)],
        const SizedBox(height: VinkSpacing.lg),
        VinkPrimaryButton(label: 'Add guest', loading: _busy, onPressed: _addAsGuest),
        const SizedBox(height: VinkSpacing.sm),
        VinkTextButton(label: 'Back', onPressed: () => setState(() => _phase = _Phase.notFound)),
      ],
    );
  }

  Widget _buildGuestReadyPhase() {
    final guest = _readyGuest!;
    final link = guest.guestJoinUrl!;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('${guest.displayName} is in', style: VinkTypography.title),
        const SizedBox(height: VinkSpacing.xs),
        Text('Send them this link so they can join and pay their share — no account needed.', style: VinkTypography.bodySecondary),
        const SizedBox(height: VinkSpacing.lg),
        Center(
          child: DecoratedBox(
            decoration: BoxDecoration(color: VinkColors.white, borderRadius: BorderRadius.circular(16)),
            child: Padding(
              padding: const EdgeInsets.all(VinkSpacing.md),
              child: QrImageView(data: link, size: 160, backgroundColor: VinkColors.white),
            ),
          ),
        ),
        const SizedBox(height: VinkSpacing.md),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: VinkSpacing.md, vertical: VinkSpacing.sm + 2),
          decoration: BoxDecoration(
            color: VinkColors.ink.withValues(alpha: 0.04),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(link, style: VinkTypography.bodySmall, overflow: TextOverflow.ellipsis),
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
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Link copied.')));
                  }
                },
              ),
            ),
            const SizedBox(width: VinkSpacing.sm),
            Expanded(
              child: VinkSecondaryButton(label: 'Share', onPressed: () => Share.share(link)),
            ),
          ],
        ),
        const SizedBox(height: VinkSpacing.md),
        VinkPrimaryButton(label: 'Done', onPressed: () => Navigator.of(context).pop(guest)),
      ],
    );
  }
}
