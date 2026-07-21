export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3000';

export function wsBaseUrl(): string {
  return API_BASE_URL.replace(/^http/, 'ws');
}

/** Slice I3 (docs/design/phase-10-implementation-readiness.md) — gates the D23/D24/D25/D34
 * correctness fixes (not-open-yet state, server-truth contribution gating, six-way terminal
 * copy). Default off, same static build-time env-var pattern as `NEXT_PUBLIC_API_BASE_URL` —
 * no runtime flag service. Off preserves today's exact existing behavior (P0-2's known
 * defects, unchanged) — see Phase 10 §11's own rollback note: reverting is a known regression,
 * not a new risk. Depends on the backend's `VINKIN_CONTRIBUTION_PROJECTION_ENABLED` also being
 * on for the DRAFT-withholding half of D23 to actually take effect at the wire level; this
 * flag alone only controls whether the client bothers to render the new UI treatment.
 * Reads `vinkOutcome` first regardless (a defensive, privacy-improving default that never
 * makes things worse than today, even if the two flags are set inconsistently). */
export const GUEST_CONTRIBUTION_STATUS_UI_ENABLED =
  process.env.NEXT_PUBLIC_GUEST_CONTRIBUTION_STATUS_UI === '1';
