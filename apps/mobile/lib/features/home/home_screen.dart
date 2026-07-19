import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/models/vink.dart';
import '../../design_system/colors/vinkin_colors.dart';
import '../../design_system/components/async_state_view.dart';
import '../../design_system/components/money_text.dart';
import '../../design_system/components/status_pill.dart';
import '../../design_system/spacing/vinkin_spacing.dart';
import '../../design_system/typography/vinkin_typography.dart';
import 'home_providers.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vinksAsync = ref.watch(myVinksProvider);
    final authState = ref.watch(authControllerProvider);
    final displayName = authState is AuthSignedIn ? authState.user.displayName : '';

    return Scaffold(
      appBar: AppBar(
        title: Text('Hi, $displayName'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Log out',
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/create-vink'),
        icon: const Icon(Icons.add),
        label: const Text('New Vink'),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(myVinksProvider.future),
        child: AsyncStateView<List<Vink>>(
          loading: vinksAsync.isLoading,
          error: vinksAsync.error,
          data: vinksAsync.valueOrNull,
          onRetry: () => ref.invalidate(myVinksProvider),
          builder: (context, vinks) {
            if (vinks.isEmpty) {
              return ListView(
                children: const [
                  Padding(
                    padding: EdgeInsets.all(VinkinSpacing.xxl),
                    child: Center(
                      child: Text('No Vinks yet — tap "New Vink" to start one.', style: VinkinTypography.bodySecondary),
                    ),
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.all(VinkinSpacing.md),
              itemCount: vinks.length,
              separatorBuilder: (_, _) => const SizedBox(height: VinkinSpacing.sm),
              itemBuilder: (context, index) {
                final vink = vinks[index];
                return _VinkListTile(vink: vink, onTap: () => context.push('/vinks/${vink.id}'));
              },
            );
          },
        ),
      ),
    );
  }
}

class _VinkListTile extends StatelessWidget {
  const _VinkListTile({required this.vink, required this.onTap});

  final Vink vink;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: '${vink.purchaseCategory} vink, ${MoneyText.format(vink.requiredAmountMinor)}, status ${vink.state}',
      child: Material(
        color: VinkinColors.surface,
        borderRadius: BorderRadius.circular(VinkinSpacing.sm),
        child: InkWell(
          borderRadius: BorderRadius.circular(VinkinSpacing.sm),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(VinkinSpacing.md),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(vink.purchaseCategory, style: VinkinTypography.label),
                      const SizedBox(height: 2),
                      MoneyText(vink.requiredAmountMinor, style: VinkinTypography.title),
                    ],
                  ),
                ),
                StatusPill(vink.state),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
