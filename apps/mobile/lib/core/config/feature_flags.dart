/// Slice I5 (D30, docs/design/phase-10-implementation-readiness.md §I5) — the first
/// Flutter-client feature flag. Mirrors the backend's own static, env-var, default-off,
/// allowlist-per-environment pattern (`apps/api/src/config/env.ts`'s `VINKIN_*` flags,
/// `apps/guest-web/lib/config.ts`) rather than inventing a runtime flag service this project
/// has never had (Phase 10 §11: "no runtime flag service"). Set at build/run time via
/// `--dart-define=CANONICAL_CREATE_FLOW=true`; every build that omits it gets the exact
/// current five-step wizard, unchanged.
class FeatureFlags {
  const FeatureFlags._();

  /// Gates the ENTIRE canonical two-screen create flow as one unit — never a half-migrated
  /// hybrid (Phase 10 §I5's own explicit rule). Default off. The old five-step wizard
  /// (`create_vink_screen.dart`) remains in the codebase, fully functional, for rollback.
  ///
  /// Flag-removal condition (Phase 10 §I5 feature-flag table): removed only once the old
  /// five-step wizard is formally retired in a later, separate cleanup slice — not this one.
  static const bool canonicalCreateFlow = bool.fromEnvironment(
    'CANONICAL_CREATE_FLOW',
    defaultValue: false,
  );
}
