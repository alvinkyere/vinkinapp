import 'package:flutter/material.dart';
import '../colors/vinkin_colors.dart';
import '../spacing/vinkin_spacing.dart';
import '../typography/vinkin_typography.dart';
import 'vinkin_button.dart';

/// One loading/error/empty/data pattern for the whole app (Plan PV9 "State handling,
/// Error handling") — screens never write their own ad hoc `if (isLoading) ... else if
/// (error != null) ...` chain. Wraps a Riverpod `AsyncValue`-shaped triple explicitly
/// rather than depending on riverpod's type here, so this file has no framework coupling.
class AsyncStateView<T> extends StatelessWidget {
  const AsyncStateView({
    super.key,
    required this.loading,
    required this.error,
    required this.data,
    required this.builder,
    this.onRetry,
  });

  final bool loading;
  final Object? error;
  final T? data;
  final Widget Function(BuildContext context, T data) builder;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    if (loading && data == null) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(VinkinSpacing.xl),
          child: CircularProgressIndicator(),
        ),
      );
    }
    if (error != null && data == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(VinkinSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: VinkinColors.danger, size: 36),
              const SizedBox(height: VinkinSpacing.sm),
              Text(
                'Something went wrong',
                style: VinkinTypography.body,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: VinkinSpacing.xs),
              Text(
                '$error',
                style: VinkinTypography.bodySecondary,
                textAlign: TextAlign.center,
              ),
              if (onRetry != null) ...[
                const SizedBox(height: VinkinSpacing.md),
                VinkinButton(label: 'Retry', onPressed: onRetry, variant: VinkinButtonVariant.secondary),
              ],
            ],
          ),
        ),
      );
    }
    if (data == null) return const SizedBox.shrink();
    return builder(context, data as T);
  }
}
