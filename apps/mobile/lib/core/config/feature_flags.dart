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

  /// Slice I6 (Phase 10 §I6) — gates Home's two-section redesign, Activity's outcome-summary
  /// list, and the new Vink Details screen AS ONE UNIT (Phase 10 §11's own flag table: one
  /// flag for all of I6, same "never a half-migrated hybrid" discipline as
  /// [canonicalCreateFlow]). Default off. Today's flat Home list, flat per-event Activity
  /// list, and the absence of any Vink Details screen all remain fully functional, unchanged,
  /// for rollback.
  static const bool homeActivityV2 = bool.fromEnvironment(
    'HOME_ACTIVITY_V2',
    defaultValue: false,
  );

  /// Invites feature (D44, 2026-07-23) — gates the 4th "Invites" tab, the Home pending-invite
  /// card, and the client's own attempt to call the new accept/decline/list-invites
  /// endpoints, as one unit. Default off. The server's own `VINKIN_INVITES_ENABLED` is the
  /// real behavior switch (whether `addParticipantCommand` inserts INVITED rows at all) —
  /// this client flag only controls UI visibility; a build with it on talking to a server
  /// with it off just sees an always-empty Invites tab, safely, not broken.
  static const bool invitesEnabled = bool.fromEnvironment('INVITES_ENABLED', defaultValue: false);

  /// I7 (Phase 10 §I7, Phase 8 §15) — gates the Ink Progress vessel replacing
  /// `VinkProgressIndicator` on the Lobby (organizer + participant) and Home's compact card,
  /// as one unit. Default off; the linear bar stays in the codebase, fully functional, for
  /// rollback (same discipline as every prior flagged slice).
  static const bool inkProgressVessel = bool.fromEnvironment(
    'INK_PROGRESS_VESSEL',
    defaultValue: false,
  );
}
