# 00 — Current-State Assessment & Gap Analysis

_Date: 2026-07-16. Author: architecture pass against the VinkIn Master Engineering Roadmap
(the "Spec"). Spec section references use §N._

## 1. Current state

The repository is **empty**. There is no prior code, no git history, no configuration, no
provider accounts wired in. This is a greenfield build whose only asset is the Spec itself.

Local machine toolchain at time of writing:

| Tool | Status |
|---|---|
| Node.js | v25.8.1 (supports native TypeScript type-stripping — used by the M0 spike) |
| npm | 11.11.0 |
| pnpm | **not installed** (required for the monorepo — Milestone 1) |
| git | 2.50.1 (repo not yet initialized — owner will run `git init` themselves) |
| Flutter SDK | **not installed** (required from Milestone 1) |
| Docker | not verified |

Environment note: a `CLAUDE.md` exists one directory up (`~/Downloads/CLAUDE.md`) describing an
**unrelated** project ("Runtime", an iOS JS-connector app). It is not part of VinkIn. Because
tooling walks parent directories, it will leak into sessions until VinkIn moves out of
`~/Downloads` or that file moves into its own project folder. Mitigation: this repo has its own
`CLAUDE.md`; recommend relocating the repo to `~/code/vinkin` (also removes the space in the
path, which breaks some scripts).

## 2. Gap analysis against the Spec

Because the repo is empty, every §39 milestone is open. The useful analysis is not "what code is
missing" (all of it) but **what the Spec itself leaves undecided** — the decisions that block
implementation, in dependency order.

### 2.1 Existential gaps (block everything; resolve in Milestone 0)

| # | Gap | Why it blocks |
|---|---|---|
| G1 | **No financial provider selected.** §43 mandates a provider-neutral interface, but §39 M0 requires confirming ~12 provider capabilities that differ materially between Stripe, Lithic, Marqeta, etc. | Card issuance model, auth webhook latency, capture semantics, and funds flow all depend on it. See `docs/provider-integration/00-provider-feasibility.md`. |
| G2 | **Funds-flow legal structure undecided.** Collecting money from participants and disbursing it to a merchant via a platform-controlled card is money-transmission-adjacent. Whether VinkIn can operate under a provider's program (payfac/issuing program, FBO-style account) or needs its own licensure is a legal question, not an engineering one. | Determines whether the product as specified can launch at all. §39 M0 explicitly demands "open legal/compliance questions." |
| G3 | **Consumer vs. commercial card program.** The Spec assumes a temporary virtual card presented by a consumer organizer. Some issuing programs (notably Stripe Issuing in the US) are commercial-card programs with the *platform business* as the accountholder; whether an end-consumer may be the authorized spender of a platform-funded card is a program-design question requiring provider sign-off. | Affects cardholder data model (§30 `cardholders`), KYC scope (§10.1), and card display UX (§16). |

### 2.2 Design decisions the Spec delegates (resolve before the affected milestone)

| # | Gap | Needed by | Proposed default (flagged, not silently adopted) |
|---|---|---|---|
| G4 | Guest token security model detail: TTL, binding (Vink + slot + optional phone-OTP), replay handling. §31 has `POST /guest-vinks/:token/verify` but no verification factor defined. | M4 | Signed opaque token, 15-min TTL, single slot binding; SMS OTP only when share > configurable threshold. |
| G5 | Auth provider: build OTP auth in-house vs. delegate (e.g., provider-hosted identity). §35 lists requirements only. | M2 | In-house phone OTP via SMS gateway + short-lived JWT access / rotating refresh tokens (spec-compliant, no vendor lock). |
| G6 | Realtime transport: WebSocket vs. SSE (§7 allows either). | M3 | SSE for guest web (simpler through proxies), WebSocket for the Flutter app; both fed by the same outbox-driven event stream. |
| G7 | Split rounding rule: §38 requires rounding tests but no rule is stated. | M3 | Largest-remainder method; organizer absorbs residual cents; property-tested `sum(shares) == total`. |
| G8 | Slippage tolerance values for EXACT_FINAL (§20 "small configurable"). | M7 | Config: `max(100 minor units, 1%)` capped at $5, per-category overridable; stored per Vink at creation. |
| G9 | Processing-grace timings (§14 gives "recommended initial" values). | M5 | Adopt §14 values as config defaults: submissions close T−15s, grace T+60s; all server-side, feature-flagged. |
| G10 | Restaurant adjustment charging: whether "PARTICIPANT_PREAUTHORIZED" adjustments (§22) can be charged post-capture depends on provider off-session charging + mandate rules. | M0 spike → M8 | Verify in M0; fall back to organizer-only adjustments (§23) if off-session participant charging is not cleanly supportable. |
| G11 | KYC depth for organizer verification (§10.1): document-level identity verification vs. data-based. Cost per verification matters at consumer scale. | M2 | Provider-hosted verification (e.g., Stripe Identity or program-mandated KYC); decision follows G1/G3. |
| G12 | Notification channels for time-critical events (card ready, adjustment created): push only vs. push+SMS. | M3+ | Push primary; SMS fallback for guests (no app). |

### 2.3 Spec self-consistency notes (flagged per §9 "do not silently change")

1. §13 state machine shows `SUBMISSIONS_CLOSED → EVALUATING` when no unresolved attempts exist,
   but §14 routes everything through `PROCESSING_GRACE`. Interpretation adopted: `EVALUATING` is
   the zero-length fast path of the same resolver; both paths run identical locking code
   (§14 "expiry worker and webhook processor must use the same locking strategy"). Recorded in
   `03-state-machines.md`.
2. §11 lists slot statuses including `INVITED/JOINED` (membership-ish) alongside payment
   statuses. Adopted: membership lives on `vink_members`; `contribution_slots` begin at
   `PAYMENT_NOT_STARTED`. The §11 vocabulary is preserved in API responses by projection.
3. §31 has no explicit split-approval endpoint for revised amounts (§15 requires participant
   re-approval). Adopted: re-approval rides the existing contribution attempt flow
   (`POST /contribution-slots/:slotId/attempts` against the new split version); flagged in the
   API design doc when M3 starts.
4. §43 `FinancialProvider` has no webhook-parsing method, but §28 requires signature
   verification per provider. Adopted: interface extension `parseWebhookEvent()` (see
   `packages/payment-provider`) — an additive change, not a product change.

## 3. What exists after this pass

- `docs/` — the ten §45 artifacts (this file and siblings).
- `packages/payment-provider/` — provider-neutral interface + `MockFinancialProvider` + tests
  (the code half of the M0 spike; runs with zero dependencies via `node --test`).
- `README.md`, `CLAUDE.md` — orientation for humans and future agent sessions.
- **Not yet:** git history (owner-initialized), the verbatim Spec text
  (`docs/spec/` — paste the master prompt there as `master-roadmap-prompt.md`; it is the
  authority all docs cite), monorepo tooling, apps.

## 4. Immediate blockers requiring the product owner (not code)

1. Choose provider candidates and open sandbox accounts (M0; needs business entity details).
2. Engage counsel on G2 (funds flow / money transmission) — engineering can only frame the
   question, which `00-provider-feasibility.md` does.
3. Run `git init` + first commit (owner identity).
4. Install pnpm and the Flutter SDK before Milestone 1.
