# Decision Log

Every interpretation of the Spec, every G1–G12 resolution, and every architectural choice
gets an entry. Statuses: `PROPOSED` (engineering default, not yet ratified by the owner),
`ACCEPTED`, `REJECTED`, `SUPERSEDED (by Dn)`. Newest entries at the top. No decision is
implemented while `PROPOSED` if it touches money, the Spec's §4 invariants, or a frozen
contract.

---

## D49 — RM4C: realistic payment selection, a global (not per-command) Stripe-sandbox provider switch, and a narrow provider-import-guard exception for Stripe's client-only SDKs

- **Decision:** the owner supplied an RM4C brief ("realistic payment selection and Stripe
  sandbox checkout") requiring the organizer mobile app and guest web to present real payment-
  method options and complete at least Debit/credit card through a genuinely functional Stripe
  sandbox flow, without exposing "Pay with Stripe" as a consumer method and without coupling the
  UI directly to the Stripe SDK. Three sub-decisions, each disclosed and confirmed before
  implementation (per §9):
  1. **Provider selection is a single global switch, not per-command routing.** A new
     `VINKIN_FINANCIAL_PROVIDER` env var (`mock` default, `stripe_sandbox` opt-in) selects the
     ONE `FinancialProvider` instance `apps/api/src/server.ts` passes to every command —
     contributions, card-pool, purchases alike — matching the one documented model
     (`docs/product-validation/master-plan.md`: "only the provider adapter changes after
     provider selection"). The real, disclosed trade-off: in `stripe_sandbox` mode, RM2/RM3B's
     card-pool/wallet-provisioning commands will visibly throw `NOT_SUPPORTED`, since the real
     Stripe adapter honestly declares `walletProvisioning: false` (unchanged pre-existing gap,
     blocked on Stripe's own Financial Account v2 wall, ENG6's own finding) — never silently
     emulated (§9, §21, D7). The alternative (two live provider instances, one for
     contributions and one for card-pool) was considered and rejected — a genuinely new
     architecture pattern with no precedent anywhere in this codebase, for a milestone whose
     own scope is participant payment collection, not organizer card issuance.
  2. **`packages/payment-provider-contract-tests`' `confirmContributionPaymentIntent` hook**
     lets both `MockFinancialProvider` and the real Stripe sandbox adapter prove the new
     client-secret-based hosted-collection method (`createContributionPaymentIntent`) through
     the same conformance suite (D7) — Stripe's own documented test PaymentMethod IDs
     (`pm_card_visa`, `pm_card_visa_chargeDeclined`) confirm a real sandbox PaymentIntent
     server-side, the same technique Stripe's own docs recommend for backend testing.
  3. **`tooling/scripts/check-provider-imports.mjs`'s `@stripe` scope block gained a narrow,
     explicit allowlist** for `@stripe/stripe-js` and `@stripe/react-stripe-js` — browser-only
     client SDKs that never hold a secret key and cannot move money by themselves (real card
     collection happens entirely inside Stripe's own hosted iframe, using only the public
     `STRIPE_PUBLISHABLE_KEY`). The guard's original purpose (D7/§42/§43: keep the
     secret-key-bearing server SDK out of anywhere but the approved adapter directories) is
     unaffected; blocking the client SDKs too would have made RM4C's own explicit requirement
     ("use Stripe's supported client-side payment components") structurally impossible to
     satisfy, since that SDK is deliberately designed to be imported straight into the UI
     component rendering the card form.
- **New architecture, not previously documented:** a verified provider webhook re-enters the
  contribution engine through the EXISTING, SH1-hardened `resolveContributionCommand` (E5's
  own stuck-pending recovery resolver) — never a new, competing resolver. A new
  `processContributionPaymentEvent` (`apps/api/src/modules/contributions/routes.ts`) looks up
  the contribution by `provider_reference` after a webhook is durably stored, and calls
  `resolveContributionCommand` with `requester: undefined` (trusted internal caller, exactly
  matching `jobs/sweeps.ts`'s own precedent). This preserves D5 (one resolver decides
  FUNDING_CONFIRMED/FUNDING_FAILED) and D15 (provider calls inside the unit of work, unchanged)
  — the webhook is a TRIGGER to re-check real provider truth via `retrievePaymentStatus`, never
  itself trusted as the outcome, which is what makes "a client callback without a successful
  webhook never marks the contribution paid" true by construction, proven by a dedicated
  integration test (`apps/api/src/rm4c-payment-session.integration.test.ts`).
- **Date:** 2026-08-03
- **Status:** ACCEPTED — sub-decision 1 confirmed via `AskUserQuestion` before implementation
  (owner chose "global flag, default off" over per-flow provider routing); sub-decisions 2/3
  are engineering-scoped extensions of already-ratified D7 discipline, disclosed here rather
  than made silently.
- **Reason:** see brief summary above — RM4C's own text explicitly requires a genuinely
  functional Stripe-sandbox card flow from both clients while keeping mock mode fully
  supported and the provider boundary intact.
- **Affected modules:** `packages/payment-provider` (types/interface/mock),
  `packages/providers` (Stripe adapter, contract test), `packages/payment-provider-contract-tests`,
  `packages/application` (`contributions.ts`'s new `createContributionPaymentSessionCommand`,
  new `payment-methods.ts`), `apps/api` (`config/env.ts`, `server.ts`, `app.ts`,
  `modules/contributions/routes.ts`, `modules/webhooks/routes.ts`, new
  `modules/payment-methods/routes.ts`), `apps/guest-web` (new Stripe Elements payment UI),
  `apps/mobile` (new `flutter_stripe` PaymentSheet UI), `tooling/scripts/check-provider-imports.mjs`.
- **Revisit trigger:** Stripe's Financial Account v2 wall clearing (would let `walletProvisioning`
  become `true` on the real adapter, removing sub-decision 1's disclosed trade-off); a real
  Apple Developer account or an approved Venmo/Cash App Pay adapter (RM4C-D/E's own disclosed
  external blockers, unchanged by this decision).

## D48 — SH1 opens a new, repeatable Security-Hardening (`SH`-numbered) track, parallel to but distinct from the fixed ENG0–ENG15 sequence

- **Decision:** the owner supplied a "Security Hardening Milestone (SH1)" brief — a
  comprehensive offensive security review, self-named `SH1` and framed as the first of a
  repeatable series ("...future security milestones (SH2, SH3, etc.)"). `ENG10`–`ENG15` already
  have fixed, different scopes defined in `docs/architecture/eng-roadmap.md` ("Closed simulated
  pilot," "Provider integration foundation," etc.), so SH1 does not get folded into an
  ENG-numbered slot or renumber anything. It's treated the same way the Real-Money Beta track
  (D47, `RM1`–`RM7`) was: a separate, owner-opened sequence with its own prefix, tracked via
  milestone reports (`milestone-reports/SH1-SECURITY-HARDENING.md`) and this running log, not
  via a new section in `eng-roadmap.md` itself (that file is a static, owner-authored reference
  of the ENG0–ENG15 sequence — the RM track was never added there either; both live in
  `CLAUDE.md`'s narrative and milestone reports instead).
- **Date:** 2026-08-03
- **Status:** ACCEPTED (flagged here per the owner's own answer, during SH1 scoping, that this
  should "register as the next ENG milestone" — interpreted as "follow the milestone-report/
  decision-log convention," not literally overwrite a fixed ENG10–15 slot, since those already
  have different owner-authored scopes; disclosed as a judgment call, not decided silently, per
  the repo's own hard rule (§9) — open to renumbering if the owner prefers something else)
- **Reason:** ENG8 ("Security hardening") already closed as a one-time pass before the original
  external-pilot gate; the brief's own repeatable `SH1/SH2/SH3` framing signals an intentionally
  recurring verification cadence distinct from ENG8's one-time checklist, and the RM1–RM4B
  track added the largest new financial attack surface in the codebase's history (card pool,
  wallet tokens, capture-immediately funding) with zero dedicated security review before SH1 —
  a real, current gap, not a re-run of already-closed ENG8 ground.
- **Alternatives considered:** treat it as literally "ENG10" (rejected — ENG10 already has a
  fixed, different, owner-authored scope, "Closed simulated pilot," reusing the number would
  overwrite it silently); skip any log entry and just ship the code changes (rejected — the
  brief's own "no security issue should be fixed silently" instruction and this repo's §9 rule
  both call for a durable, citable record of a new process/naming convention, not just the
  fixes themselves).
- **Affected modules:** process/documentation only — `docs/architecture/eng-roadmap.md` is
  unchanged (SH1 doesn't claim any of its numbered slots); `CLAUDE.md`'s running log and
  `milestone-reports/` gain the SH1 entry.
- **Revisit trigger:** an owner decision to fold future SH-numbered work into the ENG sequence
  instead, or to renumber/rename the track.

## D47 — Real-Money Beta: VinkIn-as-cardholder funds flow, reusable card pool, dual-timer Vink/card lifecycle, wallet-only card exposure

- **Decision:** the owner supplied and approved a full "VinkIn Real Money Beta" specification,
  recorded here close to verbatim as the canonical reference (the source documents are the
  owner's own messages in this session; this entry is the durable record):
  - **Cardholder/funds flow:** VinkIn (not the organizer) is the legal cardholder. Every issued
    card spends from VinkIn's own Stripe Financial Account. Canonical flow: Participant Payment
    → Stripe PaymentIntent → VinkIn Stripe Financial Account → Internal Ledger → Vink reaches
    100% → Reserve Card → Configure Spending Controls → Provision to Apple/Google Wallet →
    Organizer receives card → Merchant Purchase → Settlement → Card returns to pool.
  - **Capture timing (owner-clarified during planning):** participant payments CAPTURE
    immediately per payment — money lands in VinkIn's Financial Account as each participant
    pays, not held as an authorization until the Vink completes. This is a real change from
    the engine's existing authorize-then-capture-on-completion model (D5's single resolver),
    not merely a restatement of the eventual destination of funds.
  - **Card pool:** 15 reusable virtual cards, never shared, one active Vink at a time per card.
    Disabled by default; enabled only while assigned to an active funded Vink. A card is
    reserved only after every required participant has paid, the Vink reaches 100%, and system
    validation confirms no outstanding issues. Every assignment configures spending controls
    (amount, merchant restrictions, permissions, expiration). A card returns to the pool only
    after purchase completes and settlement occurs.
  - **Wallet-token-scoped authorization (owner-clarified during planning):** authorizations are
    approved against the assigned wallet token, not solely the underlying reusable card. The
    token — not the card row — is the real authorization-time identity for a given assignment;
    it must be independently provisioned per assignment and revoked before the card is treated
    as returned to the pool, so a stale device from a prior assignment can never authorize
    against a card now assigned elsewhere.
  - **Dual-timer lifecycle, distinct from each other:** Vink maximum lifetime is 7 minutes
    (down from today's 24h `VINK_OPEN_DURATION_SECONDS` default); on expiry the Vink closes
    permanently, no further participants may join, no card is assigned, and refunds begin
    automatically for every contribution already captured. Separately, once a card is
    provisioned to the organizer's wallet, the organizer has 10 minutes to complete the
    purchase; if unused, the card is disabled, contributors are refunded, and the card returns
    to the pool after the refund process completes. All of the above are configuration values,
    not hardcoded.
  - **Beta caps (configuration, not hardcoded):** max Vink amount $100, max participants 8, max
    active Vinks 10, card pool size 15, invite-only, US region only.
  - **Wallet-only card exposure:** no "View Card Details" screen exists at all; the organizer
    is always prompted to add the issued card to Apple Wallet/Google Wallet as the sole primary
    action once a Vink reaches 100% — never a choice among payment methods, never raw card
    number/expiry/CVV manually copied or displayed anywhere in VinkIn's systems.
  - **Merchant support:** all merchant categories the issuing program supports; no
    VinkIn-imposed category restriction beyond the spending controls configured per card.
    Engineering still accounts for delayed captures, incremental authorizations, and refunds.
  - **Merchant declines (initial beta policy, may evolve):** reuse the same assigned card and
    retry after appropriate handling, rather than reassigning a different pool card.
  - **Refunds/disputes:** expired Vinks and unused-card expiry both trigger automatic refunds
    to every contributor; VinkIn absorbs Stripe's refund processing costs during the beta.
    Participant disputes go through manual review in the Operations Console (an operator-
    triggered, narrowly scoped, fully audited refund path — not a general refund capability).
  - **Guests remain permanent and frictionless:** no account creation, identity verification,
    or app install required to participate as a guest.
  - **Pricing:** no organizer fee, no member fee, during the beta.
  - **Beta success targets:** ~50 invited testers, 100 successfully completed Vinks; primary
    metrics are Vinks created per week, average funding time, completion rate, repeat users.
  - **Payment methods:** every method the selected Stripe integration supports (Apple Pay,
    Google Pay, debit, credit) is available to participants.
- **Date:** 2026-07-28
- **Status:** ACCEPTED (owner-directed; the funds-flow/cardholder/card-pool/wallet decisions
  above were supplied pre-approved; the capture-timing and wallet-token-scoped-authorization
  clarifications were confirmed via direct question during the resulting implementation
  planning session)
- **Reason:** resolves VinkIn's central unresolved question — what the production funds-flow
  and card architecture actually are once the M0 gate's conditions are eventually met — and
  gives engineering a concrete target to build against (in sandbox mode, under D46's existing
  guard) instead of continuing to leave the post-funding experience an unresolved slot.
- **Alternatives considered:** keep capture-on-completion (today's model) and treat "refunds
  begin automatically" as hold-cancellation only (rejected — the owner's own flow diagram
  describes money landing in VinkIn's account as each participant pays, and confirmed this
  explicitly when asked directly, since the two models have materially different refund/dispute
  and reconciliation implications); scope wallet-token validation as a card-level concern only,
  relying on `card.status` alone the way `authorizeMerchantPurchaseCommand` does today
  (rejected — the owner explicitly clarified authorization is token-scoped, and a card-only
  check would leave a real reassignment-security gap where a previous holder's device could
  still authorize against a card now assigned to a different Vink); defer recording this as a
  decision-log entry until individual RM slices land (rejected — owner directed recording it
  now, matching the D45→D46 precedent of writing the decision down before the code that acts on
  it).
- **Affected modules/decisions amended:**
  - **D32** (Deliberate Ready-to-Pay entry with provider-dependent presentment) and **D35**
    (provider-dependent payment copy remains an unresolved slot) — both explicitly named "M0
    gate closure / provider selection" as their revisit trigger; this decision is that trigger.
    Their placeholder ("Ready to Pay" shell / unresolved presentment copy) gets real content
    from the RM-slice work this decision authorizes; D32/D35 are resolved, not superseded.
  - `docs/architecture/06-milestone-0-gate.md` — needs a second, narrower carve-out alongside
    D46's existing sandbox exception, since "Card-display UI" is currently explicitly Forbidden
    while the gate is open. This decision authorizes that amendment; it does not itself edit
    the gate document (a separate, immediate follow-up action).
  - `apps/api/src/modules/reconciliation/routes.ts`'s own header comment ("no route here can
    move money, approve a payment, issue a refund, create a card, or alter a provider/ledger
    record") — amended to permit exactly one new, narrowly scoped, fully audited
    operator-triggered refund route for participant disputes (RM6), not a general refund
    capability.
  - `packages/domain` (card pool states/events, dual-timer Vink lifecycle, wallet-token
    lifecycle), `packages/application/src/{purchases,refunds,contributions,commands}.ts`
    (capture-on-payment funding engine, card reservation/return, wallet-token provisioning/
    revocation), `packages/payment-provider` + `packages/providers` (new provider-interface
    methods: enable/activate a card, provision/revoke a wallet token — touches the D7
    conformance suite and both the mock and Stripe adapters together, per the existing hard
    rule), `apps/api/src/db/migrations` (new `cards`/`card_assignments`/`card_wallet_tokens`
    schema replacing today's DB-`UNIQUE` 1:1 `temporary_cards`), `apps/mobile` (wallet
    provisioning, no card-details screen, dual-timer countdown UI), `apps/operations-console`
    (dispute review screen + scoped refund route), `docs/feasibility/funds-flow.md` (gate
    condition #3's own named evidence file, to be filled in as RM slices land against the real
    Stripe sandbox).
  - **Explicitly does not close the M0 gate.** This decision advances gate conditions #2
    (cardholder/account ownership — now defined), #3 (funds-flow documented — evidence file
    started as a direct consequence), and #7 (sandbox tests — ENG6's existing passing Stripe
    sandbox suite extends to cover this). It does not satisfy conditions #1, #5, #6, #8, #10 —
    those still need external evidence (a provider's own written funds-flow confirmation, KYC
    program definition, counsel review, a scored risk register) per the gate document's own
    rule that a condition without a linked evidence artifact is not met regardless of internal
    approval. All RM-track engineering proceeds against the sandbox provider under D46's
    existing guard; no live-mode credential or real-money movement is authorized by this entry.
- **Revisit trigger:** the M0 gate's own ten conditions closing in full (unchanged authority);
  any owner change to the capture-timing or wallet-token-scoped-authorization clarifications
  above, since multiple RM slices are built directly on them; the merchant-decline "reuse same
  card" policy is explicitly disclosed as likely to evolve after real-world observation, so a
  future change there does not require re-litigating this whole entry.

## D46 — M0 gate amended with a narrow, hard-guarded sandbox-only exception for ENG6

- **Decision:** `docs/architecture/06-milestone-0-gate.md` is amended (not discarded) with a
  new **Sandbox-only exception** section. A sandbox-mode provider integration (initially
  Stripe) is now permitted specifically for technical validation and demonstration — proving
  VinkIn's architecture maps onto a real provider's actual API shape. This does **not**
  satisfy any of the gate's ten conditions and does **not** authorize real-money movement,
  live card issuance, consumer fund custody, or public launch. Hard guards, enforced in code
  not just by convention: sandbox/test-mode credentials only, in every environment including
  the demo — a live-mode key must fail to boot, the same fail-fast discipline this codebase
  already applies to `JWT_SECRET`/`OPERATOR_PASSWORD`; a webhook endpoint and signing secret
  isolated from any future live-mode equivalent; the existing off-by-default/boot-refused-
  outside-development-test flag discipline. ENG6 Slices 3 (sandbox adapter) and 4's
  real-provider webhook half now proceed under these constraints.
- **Date:** 2026-07-26
- **Status:** ACCEPTED (owner-directed, explicit reversal of D45's "do not amend" direction)
- **Reason:** after D45 was recorded, the owner identified a real, meaningful distinction D45
  had not drawn: sandbox credentials and live credentials are structurally different (Stripe
  issues sandbox/test-mode API keys freely, with no business approval, commercial
  relationship, or KYC program required — genuinely decoupled from the ten gate conditions,
  which govern *live* funds-flow approval, not technical integration proof). A sandbox demo
  proves the adapter calls the right APIs, webhook verification/translation/idempotency work,
  and the UI can show the complete experience; it does **not** prove Stripe has approved
  VinkIn's business model, that live-mode will enable the same capabilities, or that
  Treasury/Issuing/Connect commercial and compliance requirements are satisfied — the gate's
  ten conditions remain the only authority on those.
- **Alternatives considered:** hold Slice 3–4 until the gate fully closes (D45's original
  position — superseded here, not wrong at the time, reflecting the owner's own
  reconsideration after weighing the sandbox/live distinction); remove the M0 gate's
  Forbidden-list language entirely rather than add a scoped exception (rejected — the owner's
  own instruction was explicit: "amend — not discard"; a full removal would also blur the
  line for genuinely live-money-shaped work the gate must keep blocking).
- **Affected modules:** `docs/architecture/06-milestone-0-gate.md` (new exception section,
  Permitted/Forbidden lists updated to reference it), everything D45 already listed
  (`packages/payment-provider`, webhook ingestion, reconciliation scaffolding, ops console),
  plus a new sandbox-mode Stripe adapter under `packages/payment-provider`'s existing
  approved-adapter-directory convention (§42/§43 — no change to where provider SDK code is
  allowed to live, only to whether sandbox-mode code may exist there yet).
- **Revisit trigger:** M0 gate conditions 1–10 being met in full (unchanged from D45) closes
  the gate entirely, at which point this exception's own scoping (sandbox-only) becomes moot
  — live-mode work is then governed by the now-closed gate's own M0 report, not this decision.

## D45 — ENG6 split into a provider-independent Phase A and a gate-blocked Phase B [SUPERSEDED by D46]

- **Decision:** ENG6 ("Financial Provider Readiness and Integration Boundary") proceeds only
  on the work that doesn't require a real provider or real sandbox credentials — adapter
  contract hardening (typed inputs/results, provider error classification), a webhook
  ingestion framework (route, signature verification, `(provider, provider_event_id)`
  dedupe, replay/timestamp protection, dead-letter handling), reconciliation scaffolding
  (detection logic and its data model), operations-console read-only tooling for all of the
  above, and a golden-path test proven against `MockFinancialProvider`'s own synthetic,
  self-signed events (`MockFinancialProvider.sign`). A real provider SDK, real sandbox
  integration, webhook signature verification against a live provider, and any
  provider-specific adapter implementation (ENG6's own Slice 3, and the real-provider half of
  Slice 4) explicitly do **not** proceed under this decision.
- **Date:** 2026-07-26
- **Status:** SUPERSEDED (by D46) — the owner reversed this decision's "do not amend the M0
  gate" direction within the same session, after weighing the sandbox/live-credential
  distinction D46 records. This entry is kept for the historical record of what was decided
  and why, not as current guidance — read D46 for the governing decision.
- **Reason:** ENG6 Slice 1's own capability audit (`milestone-reports/ENG6-SLICE-1-PROVIDER-
  CAPABILITY-AUDIT.md`) found Slices 3–4 as originally written closely match what
  `docs/architecture/06-milestone-0-gate.md` — this repo's own stated authority on M0 — names
  explicitly in its Forbidden list while the gate is open ("Stripe-specific schemas or
  webhook tables," "real contribution capture flows"), with all ten gate conditions still
  `☐ OPEN`. Flagged to the owner per §9 rather than resolved silently or assumed either way.
  Owner's explicit direction at the time: **do not supersede or amend the M0 gate**.
- **Alternatives considered:** treat ENG6 as implicitly superseding the gate (rejected at the
  time — explicitly declined by the owner); hold all of ENG6 until the gate closes (rejected —
  the owner identified real, provider-independent value in hardening the boundary now,
  matching the gate's own Permitted list).
- **Affected modules:** see D46.
- **Revisit trigger:** superseded — see D46.

## D44 — Invites: a real INVITED → accept/decline gate before an added member is JOINED

- **Decision:** an existing VinkIn member added to someone else's Vink by the organizer no
  longer becomes `JOINED` immediately. Behind a new flag (`VINKIN_INVITES_ENABLED`), they start
  `INVITED` and must call a new `acceptInviteCommand` (→ `JOINED`) or `declineInviteCommand`
  (→ `REMOVED`, reusing the canonical terminal state rather than inventing a fourth
  `ParticipantStatus` value) themselves before they can contribute money
  (`authorizeContributionCommand` already required `JOINED`) or appear in their own "my Vinks"
  list (`GET /api/v1/vinks`, now `status = 'JOINED'`-scoped, was `!= 'REMOVED'`). A new `GET
  /api/v1/invites` surfaces the invitee's own pending invites, and a 4th "Invites" mobile tab
  plus a Home "You're invited to…" card (dismiss-only "Not now"; the real Decline lives on the
  Invites tab) give it a UI. This is genuinely new product scope — no prior I1–I11 slice or
  design doc specified an accept/decline gate; it originated from the owner directly comparing
  two aspirational mockups against the shipped app and choosing "build the full version."
- **Date:** 2026-07-23
- **Status:** ACCEPTED (owner-directed, chosen from three sized options — full feature, a
  lighter dismiss-only card with no lifecycle change, or deferring entirely — during the same
  session that produced this decision)
- **Reason:** the mockups' "You're invited to… Not now / View" card implies real agency over
  joining a Vink, which the shipped app never had (an organizer's add was always instant and
  final from the added member's side). `ParticipantStatus`'s `INVITED` value already existed in
  the domain type and the DB CHECK constraint (never assigned anywhere) — the domain was
  effectively built anticipating this, not retrofitted for it.
- **Alternatives considered:** a lighter dismiss-only Home card with no real lifecycle gate
  (rejected: doesn't match the mockup's implied agency, and the owner explicitly chose "full");
  reusing `GET /api/v1/vinks`'s existing `role` field with a third `'invited'` value instead of
  a separate endpoint (rejected: that field already means "I'm really in this" to every existing
  consumer — Home, Activity — overloading it risked silently mixing not-yet-accepted invites
  into surfaces that assume real participation, exactly the bug `listVinksByParticipant`'s own
  filter change was written to prevent).
- **A Vink can still open while a member is INVITED (unaccepted).** The existing split/open-
  readiness math (`activeParticipants`, `computeAllowedActions`, `unallocatedAmount`,
  `fundingParticipants`) already treats every non-`REMOVED` participant as occupying a real
  funding slot — an invite that's never accepted simply expires the Vink at the deadline exactly
  like today's "never paid" case. Chosen over requiring universal acceptance before opening
  because it needed zero changes to already-consistent code, not because the alternative was
  considered and rejected on product grounds — flagged as adjustable if the owner disagrees.
- **An INVITED user can preview the full participant view before deciding** (`getParticipantVinkView`'s
  existing `status !== 'REMOVED'` boundary already permits this) — makes "View" on the Home
  card meaningful from day one, at the cost of a not-yet-accepted invitee seeing the same detail
  a joined participant would.
- **Operational finding, not a code defect:** the server-side flag
  (`VINKIN_INVITES_ENABLED`) and the client-side flag (`FeatureFlags.invitesEnabled`) must roll
  out together, not the server alone first. Turning the server flag on while a client build
  still lacks the Invites tab leaves an added member stuck `INVITED` with no UI to ever accept —
  they can't pay, and the organizer's own Vink can't fund. Caught directly: running the existing
  `e1_test.dart` regression against a server with the flag on (but a client build without it)
  reproduced exactly this stuck state. Documented here rather than worked around in code, since
  the fix is a deployment-sequencing rule, not a software gap — same "client flag only gates UI
  visibility, server flag is the real behavior switch" pattern already established by
  `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL`, but this is the first case where the two flags being
  out of sync produces a genuinely broken state rather than a merely-empty screen.
- **Affected modules:** `packages/domain` (`entities.ts` — `Participant.invitedAt`/nullable
  `joinedAt`; `domain-events.ts` — `ParticipantInvited`/`ParticipantInviteAccepted`/
  `ParticipantInviteDeclined`), `packages/application` (`commands.ts` — `addParticipantCommand`;
  new `invites.ts`; `support/guards.ts` — new `loadVink`), `apps/api` (migration `0014`,
  `modules/vinks/store.ts`, `modules/vinks/routes.ts`, `config/env.ts`,
  `realtime/message-mapping.ts`), `apps/mobile` (`app/nav_shell.dart`, `app/router.dart`, new
  `features/invites/*`, new `design_system/components/pending_invite_card.dart`,
  `features/home/home_screen.dart`, `core/repositories/vink_repository.dart`,
  `core/config/feature_flags.dart`).
- **Revisit trigger:** if the owner wants universal-acceptance-before-open, or wants "Not now"
  to mean a real decline rather than dismiss-only, both are flagged above as adjustable defaults,
  not settled product decisions.

## D43 — Vink Details is aggregate-only for the organizer, own-data-only for a participant — never a per-participant roster

- **Decision:** the organizer's Vink Details view (`VinkDetailsView`, `packages/application/
  src/guest.ts`) exposes only a customer-safe AGGREGATE summary
  (`confirmedAmountMinor`/`confirmedParticipantCount`/`totalParticipantCount`) — never a list of
  every participant's own name/amount/status. A participant's own view exposes only their own
  `assignedShareMinor`/`confirmedAmountMinor`/`contributionOutcomeLabel` plus the organizer's
  identity — never another participant's data. This corrects Slice I6's own first-pass
  implementation (built before this decision, never shipped), which read Phase 4 §11's "full
  detail is appropriate here… not the guest privacy-scoped view" as license for a complete
  per-participant roster visible to every viewer (organizer and every participant alike) — the
  same widened view for everyone. The owner corrected this before the slice closed: Phase 4
  §11's widening is about the ORGANIZER seeing more than a bare guest link would show, not about
  every participant seeing every other participant's money.
- **Date:** 2026-07-23
- **Status:** ACCEPTED (Slice I6, owner-directed correction before ship)
- **Reason:** a per-participant roster leaks one participant's payment status/amount to every
  other participant on a screen with no access-control reason to show it — the same
  "own-contribution-only" boundary D24/D25/D42 already enforce everywhere else in this app
  (`ParticipantVinkView`, the participant activity feed). Vink Details had no principled reason
  to be the one screen that widens this.
- **Alternatives considered:** keeping the full per-participant roster for the organizer only,
  hiding it from participants (rejected: still exposes every participant's money to the
  organizer with no product requirement asking for it, and Phase 4 §11 never actually asked for
  an organizer-facing roster either — the brief's own "customer-safe participant SUMMARY
  (aggregate, not a per-participant breakdown)" language is explicit).
- **Affected modules:** `packages/application` (`guest.ts` — `VinkDetailsView`/`getVinkDetails`
  rewritten: `participants: VinkDetailsParticipantView[]` removed, replaced by `summary:
  VinkDetailsSummary` + `viewerParticipant: VinkDetailsViewerParticipant | null`), `apps/api`
  (`participant-inclusive-transport.integration.test.ts`), `apps/mobile`
  (`core/models/vink.dart`, `features/vink_details/vink_details_screen.dart` and its tests).
- **Revisit trigger:** a future product requirement that explicitly asks the organizer to see a
  per-participant breakdown (e.g. for dispute resolution) would need its own decision, not a
  silent re-widening of this screen.

## D42 — Participant-safe activity filtering: milestone allowlist + own-contribution-only scoping + payload sanitization

- **Decision:** a new `getParticipantVinkActivity` (`packages/application/src/guest.ts`) and
  route (`GET /api/v1/vinks/:vinkId/participant-activity`, flag-gated identically to
  `/participant-view`) give a signed-in participant their own customer-safe counterpart to the
  organizer-only `/activity` feed. `listActivity`'s raw rows are filtered by a fixed rule, not
  forwarded verbatim: every `'transition'` row is dropped outright (internal state-machine
  diagnostics — `from`/`event`/`to`/`actor`/`correlationId` — never customer-facing for anyone);
  an `'event'` row survives only if its `eventType` is a vink-wide milestone with no
  participant-identifying copy (`VinkCreated`, `VinkOpened`, `ParticipantJoined`,
  `ParticipantAllocationChanged`, `ParticipantRemoved`, `VinkFunded`, `TemporaryCardIssued`,
  `MerchantAuthorizationApproved`, `PurchaseCaptured`, `VinkCompleted`, `VinkCancelled`,
  `VinkExpired`) or a contribution/refund lifecycle event whose `payload.participantId` matches
  the viewer's own participant id — the same "own contribution only" boundary
  `ParticipantVinkView` already enforces (D24/D25). Everything else (internal timer states,
  provider/organizer-only diagnostics, recovery/restriction internals) is dropped. Every
  surviving entry's `detail` is reduced to `{ eventType }` only before it reaches the wire — no
  `participantId`, `actor`, `correlationId`, or amount, even for the viewer's own contribution
  event, since the copy that renders it needs nothing more. Client-side, `activityCopy()`
  (`apps/mobile/lib/features/activity/activity_copy.dart`) gained an `isOrganizerViewer`
  parameter (default `true`) so `VinkCreated`/`VinkCancelled` — the only two cases that name the
  viewer as the actor ("You started"/"You cancelled") — render neutral phrasing for a
  participant instead of a false claim.
- **Date:** 2026-07-23
- **Status:** ACCEPTED (Slice I2D, owner-directed closure of a gap I2B's own completion report
  flagged as "a genuinely new read surface," a candidate for I3/I6)
- **Reason:** the raw activity source mixes internal diagnostics and other participants'
  financial detail; no existing projection could be reused as-is, unlike `ParticipantVinkView`
  which already had one. This extends that exact precedent to a second read surface rather than
  inventing a new privacy model.
- **Alternatives considered:** enriching entries with participant names/amounts for a fuller
  feed (rejected: the organizer's own feed doesn't do this either — cut from an earlier
  milestone per `activity_copy.dart`'s own doc comment — not reintroduced here); showing
  `VinkCreated`/`VinkCancelled` to a participant with the organizer's own "You..." copy
  unchanged (rejected: factually false for a non-organizer viewer).
- **Found and fixed in the same change, not a separate defect:** `recentActivityProvider`
  (`apps/mobile/lib/features/activity/activity_providers.dart`) called the organizer-only
  `getActivity` for every Vink `myVinksProvider` returns, including participant-role ones
  (possible since I2A) — an unhandled 403 inside the merge loop failed the ENTIRE Activity feed,
  not just the one vink's entries, for any user who is a participant on even one Vink. Fixed as
  part of the same per-vink role branch this decision already required.
- **Affected modules:** `packages/application` (`guest.ts`), `apps/api`
  (`modules/vinks/routes.ts`), `apps/mobile` (`core/repositories/vink_repository.dart`,
  `features/activity/activity_providers.dart`, `activity_screen.dart`, `activity_copy.dart`).
- **Revisit trigger:** a future slice that wants to enrich the participant feed with
  identifying detail would need its own, separate privacy review — not implied by this one.

## D41 — Participant WS transport reuses `getParticipantVinkView` verbatim; no wire-envelope discriminator

- **Decision:** `GET /api/v1/vinks/:vinkId/live`'s JWT branch now falls back to
  `getParticipantVinkView` (Slice I2B's existing customer-safe read, already used by
  `GET /vinks/:vinkId/participant-view`) when `getVinkSnapshot` throws `FORBIDDEN` — gated on
  the same `VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL` flag that REST route already requires, so a
  flag-off deployment is byte-identical to pre-D41 (still an unconditional 403 for anyone but
  the organizer). No new field is added to the WS envelope to say which shape a `snapshot`
  message carries: the client already knows statically, from which role/URL it connected with,
  whether to expect `VinkSnapshot` or `ParticipantVinkView` — exactly how the guest branch
  already relies on the client knowing its own connection used a `vgt_` token. The outbox
  publisher and `RealtimeHub` are untouched: a participant subscribes to the same
  `vink:{vinkId}` channel and gets the same lean per-event payloads every other connection on
  that vink gets, same as guest support (PV10) already established — only the *initial*
  snapshot's source differs, and only for participants.
- **Date:** 2026-07-23
- **Status:** ACCEPTED (Slice I2C, owner-directed closure of a gap I2B's own completion report
  flagged as explicitly out of its scope)
- **Reason:** I2B shipped `ParticipantVinkView` as an HTTP-only read and documented the missing
  realtime channel as a known, deliberate gap. This closes it with the smallest possible
  change — reusing the read function verbatim, piggybacking on the existing flag, touching
  nothing else in the transport layer — rather than inventing a new privacy boundary or a new
  message shape.
- **Alternatives considered:** a wire-envelope discriminator field (e.g. `viewerRole`) on every
  `snapshot` message (rejected: unnecessary — the client already knows its own role from how it
  navigated to the screen, and guest support already proves this pattern works without one);
  filtering the outbox publisher's per-event payload by viewer role (rejected: the lean payload
  already carries no requester-specific data for anyone, guest included — no reason to start
  now for participants specifically).
- **Affected modules:** `apps/api/src/modules/realtime/routes.ts`, `apps/mobile`
  (`vink_lobby_screen.dart` — wires the already-generic `RealtimeClient` into the participant
  branch it previously skipped).
- **Revisit trigger:** none identified — the Activity-feed gap (a participant's own events not
  appearing in Home's "Recent activity") remains separately open, unaffected by this decision.

## D40 — Draft participants are correctable before VINK_OPENED

- **Decision:** while a Vink is still `DRAFT`, non-organizer participants may be edited or
  removed through the canonical create flow. A guest's `displayName`, `contactDestination`,
  and `deliveryMode` (SMS | EMAIL | MANUAL) are editable via a new
  `PATCH /vinks/:vinkId/participants/:participantId/guest` route and
  `editGuestParticipantCommand` (`packages/application/src/guest.ts`); a member has nothing
  client-editable (their delivery is account-driven, per I4) so only removal applies to them.
  Removal reuses the existing, unmodified `removeParticipantCommand` /
  `DELETE /vinks/:vinkId/participants/:participantId` route — organizer-ownership and
  DRAFT-only gating were already correct there, so no backend change was needed for removal
  itself. The edit contract always carries the complete resulting state (displayName +
  deliveryMode + conditional contactDestination), never a sparse patch, mirroring the existing
  invite contract exactly and avoiding "was this field omitted or unchanged?" ambiguity. A
  token is minted only when the edit transitions a guest INTO `MANUAL` from a different mode,
  and cleared only when it transitions AWAY from `MANUAL`; same-mode edits never touch the
  single-slot `access_token_hash` binding (D14/PV4) at all. The organizer is never removable
  (unchanged `removeParticipantCommand` guard) — they may only zero their own Custom share,
  the same way any participant's share is edited. Removing a participant recalculates Equal
  immediately (it is computed live from the current participant list on every build); Custom
  is not auto-rebalanced — a removal or edit that changes the assigned total simply leaves
  Custom mode unreconciled again, same as any other manual-total mismatch, requiring the
  organizer to re-enter amounts before Continue re-enables. No participant mutation of any
  kind is exposed once the Vink leaves `DRAFT`.
- **Date:** 2026-07-22
- **Status:** ACCEPTED (Slice I5B, owner brief)
- **Reason:** the canonical create flow (D30) collapses setup into two screens with no
  separate Review page to catch mistakes before opening — without in-place correction, a
  wrong guest destination or an accidentally-added person had no recovery path short of
  abandoning the draft and starting over.
- **Alternatives considered:** sparse-patch edit semantics (rejected: ambiguous "omitted vs.
  unchanged" meaning, unlike every other contract in this codebase); auto-rebalancing Custom
  amounts on removal (rejected: silently redistributing money a human explicitly typed is a
  financial-semantics change the brief explicitly prohibited — "do not introduce post-open
  participant mutation" implies the same caution pre-open, and D40 stays strictly UI/workflow,
  not a split-engine change).
- **Affected modules:** `packages/application` (`guest.ts`, `ports.ts`), `apps/api`
  (`modules/vinks/routes.ts`, `modules/vinks/store.ts`), `apps/mobile`
  (`canonical_create_vink_screen.dart`, new `canonical_edit_guest_sheet.dart`).
- **Revisit trigger:** a future slice that lets an organizer correct participants after
  opening (explicitly out of scope here).

## D39 — Purpose is first-class Vink metadata, separate from category

- **Decision:** `Vink` gains a nullable `purpose: string | null` field (migration 0013,
  `ALTER TABLE vinks ADD COLUMN IF NOT EXISTS purpose TEXT`) — a human-readable payment
  context ("Weekly grocery run") distinct from `purchaseCategory`, which remains a separate
  policy input (`packages/domain/src/policy.ts`) untouched by this change. `purpose` is
  accepted by `POST /api/v1/vinks` as an optional field at the API layer — the five-step
  wizard keeps hitting the same endpoint unmodified and simply never sends one — but the
  canonical create screen requires it client-side before Continue proceeds. Historical Vinks
  and any client that omits it read back `purpose: null`; consumers needing a display value
  fall back to category (`vink.purpose ?? vink.purchaseCategory`, applied in both the guest
  and member invitation dispatch templates). Purpose is returned through `PublicVinkSummary`
  (guest-facing projections) and the organizer's own Vink snapshot, unchanged by the D14
  guest-privacy boundary since it carries no financial or identity information.
- **Date:** 2026-07-22
- **Status:** ACCEPTED (Slice I5B, owner brief)
- **Reason:** Phase 4's screen contracts and PV13/ENG2's own flagged gap both required a
  freeform Vink name/purpose field that the domain had never modeled; the canonical create
  screen's "What are you paying for, and how much?" framing is meaningless without one.
- **Alternatives considered:** inferring purpose from category (rejected: the brief explicitly
  prohibits this — category is a coarse policy bucket, not a description a person wrote);
  making purpose required at the API layer (rejected: would break the untouched five-step
  wizard and any older client, for no benefit — the requirement is a canonical-flow UX
  decision, not a data-integrity one).
- **Affected modules:** `packages/domain` (`entities.ts`), `packages/application`
  (`commands.ts`, `guest.ts`, `delivery.ts`), `apps/api` (`modules/vinks/routes.ts`,
  `modules/vinks/store.ts`, migration 0013), `apps/mobile`
  (`canonical_create_vink_screen.dart`, `core/models/vink.dart`, `local_draft_store.dart`).
- **Revisit trigger:** a decision to enforce purpose as required at the API layer (would need
  a backward-compatibility plan for the five-step wizard first).

## D38 — Guest automatic-delivery tokens are minted at dispatch time, not invite time; resend always issues a fresh credential

- **Decision:** for `deliveryMode: 'SMS' | 'EMAIL'`, `inviteGuestCommand` no longer mints a
  guest access token at invite time (`guest_identities.access_token_hash`/`expires_at` are now
  nullable, migration 0012). The raw token is minted only once dispatch can actually happen —
  either immediately, in the same transport request, if the vink is already OPEN, or later, by
  the transport's `POST /vinks/:vinkId/open` handler, batched at `VINK_OPENED` (D23) — using a
  transport-side "claim" (a conditional `UPDATE ... WHERE access_token_hash IS NULL`) so at
  most one real send ever happens per guest even under a defensive re-invocation.
  `deliveryMode: 'MANUAL'` is unchanged from I4: the token still mints synchronously at invite
  time, since the organizer needs it back in that same response to copy/share it themselves.
  A new `POST /vinks/:vinkId/participants/:participantId/resend` endpoint exists for SMS/EMAIL
  guests only; because the single-slot `access_token_hash` binding (D14/PV4) means only one
  token can ever be valid for a guest at a time, and the raw value is never persisted, resend
  cannot "replay" the original send — it always mints a brand-new token and invalidates
  whichever one existed before, gated by a best-effort per-participant cooldown
  (`GUEST_RESEND_COOLDOWN_SECONDS`, real config not a hardcoded constant, ENG1-timer-semantics
  pattern) that doubles as the endpoint's only idempotency guard.
- **Date:** 2026-07-22
- **Status:** ACCEPTED (Slice I4B, engineering-track implementation of D19/D23/D27's own
  already-ratified "automatic guest delivery" product decision — this is the mechanism, not a
  new product choice)
- **Reason:** D14 forbids the raw guest token from ever reaching `packages/application` or
  being persisted anywhere; a token minted once at invite time and returned in that one HTTP
  response cannot be recovered later to build a delivery message or a resend, no matter how
  the dispatch trigger is architected. Deferring the mint to the exact moment dispatch (or
  resend) can use it immediately is the only design that satisfies D14 while still letting
  automatic delivery fire at `VINK_OPENED` (D23) for a guest invited during DRAFT.
- **Alternatives considered:** keep minting at invite time and store the raw token somewhere
  retrievable for later dispatch (rejected outright — directly violates D14, the hard rule
  this whole design exists to satisfy); a resend that reuses the guest's existing hash instead
  of minting fresh (rejected — impossible without violating D14 a second way, since the raw
  value behind an already-stored hash can never be recovered to resend it); a per-operator or
  per-participant rate-limiter service instead of a plain cooldown column read (rejected as
  disproportionate — VinkIn has no rate-limiting infrastructure beyond the existing public-join
  limiter, and a cooldown read against `invitation_deliveries.attempted_at` needs none).
- **Affected modules:** `apps/api/src/db/migrations/0012_guest_delivery_mode.sql`;
  `packages/application/src/ports.ts` (`GuestDeliveryMode`, nullable
  `accessTokenHash`/`expiresAt`, `PendingGuestDelivery`, new `VinkTx`/`VinkReader` methods);
  `packages/application/src/guest.ts` (`InviteGuestInput.deliveryMode`,
  `resendGuestInvitationCommand`); `packages/application/src/delivery.ts`
  (`claimGuestDeliverySlot`, `recordGuestInvitationDeliveryResult`);
  `apps/api/src/modules/vinks/{routes,store}.ts`; `apps/api/src/config/env.ts`
  (`GUEST_RESEND_COOLDOWN_SECONDS`).
- **Revisit trigger:** a real SMS/email provider is selected (§4) — its actual delivery
  latency/retry semantics may argue for a smarter resend/cooldown policy than a flat
  per-participant window.

---

## D37 — `recovery_required`'s canonical sentence is shown to the guest, not organizer-only

- **Decision:** the sentence "We're resolving your payment. You don't need to pay again." is
  now the guest-facing composition for `recovery_required`, correcting
  `docs/design/phase-6-copy-system.md` §16's "Recovery required" row and §18's own table,
  both of which originally annotated this sentence as "(organizer-only, §11; never shown as a
  participant/guest error)." This also corrects Slice I3's own interpretation of §18's
  continuity rule, which had `terminalOutcomeSentence('recovery_required', …)` return `null`
  on the theory that a guest's own status should never be re-described once confirmed. The
  composition still honors the *spirit* of the continuity rule everywhere else: no
  contribution action, no retry, no promotional content, and no raw
  provider/recovery/ledger/state-machine terminology (specifically: the `StatusBadge`'s own
  `RECOVERY_REQUIRED`/`RECOVERY_PENDING` label, "Resolving a shortfall," is suppressed for
  this composition — that phrase describes the organizer's situation, not the guest's, and
  is withheld even though the rest of the screen now speaks about resolution).
- **Date:** 2026-07-21
- **Status:** ACCEPTED (owner-directed correction, Slice I3A)
- **Reason:** a guest whose own payment shows no status at all during an organizer-side
  recovery event is a worse experience than a guest told, plainly and without alarm, that
  something is being resolved and they don't owe anything further — silence isn't actually
  more reassuring than a calm, accurate statement.
- **Alternatives considered:** leave `recovery_required` silent (guest sees whatever the
  vink's raw state produces elsewhere) — rejected, this is the status quo being corrected;
  invent a guest-specific paraphrase distinct from the organizer's own sentence — rejected,
  the owner's instruction supplied the exact canonical text verbatim, and a second, subtly
  different sentence for the same fact risks the two drifting apart later.
- **Affected modules:** `packages/application/src/guest.ts`'s own doc comments describing
  the continuity rule are unaffected (backend fields — `contributionStatus`,
  `vinkOutcome` — are unchanged; this is a client copy/composition decision only, no API
  change); `apps/guest-web/lib/guest-copy.ts` (`terminalOutcomeSentence`, new
  `guestTerminalSentence`), `apps/guest-web/features/join/SessionView.tsx`;
  `docs/design/phase-6-copy-system.md` §16, §18 amended in place.
- **Revisit trigger:** none anticipated — this is the copy layer's final word on
  `recovery_required` pending a future product decision to change the sentence itself.

---

## D36 — Contrast approval is semantic-role-specific and tool-verified

- **Decision:** no color pairing is "universally accessible" because one usage of it passes
  — every text, icon, border, control, focus, pressed, disabled, and status pairing must be
  verified against its **actual** background, per role, not inferred from a single check
  elsewhere. Normal-size text must satisfy the applicable WCAG AA contrast threshold; **font
  weight alone does not qualify text for the large-text exception** (only size, or size+weight
  per the actual WCAG large-text definition, qualifies — `buttonLabel`'s 700 weight at 15px
  does not itself grant an exception without also meeting the size threshold). The existing
  `danger` color must **not** be used for normal-size text against `paper` or `white` where it
  fails (`docs/design/phase-8-visual-system-refinement.md` §24 hand-computed a fail on this
  exact pairing). Explanatory error and destructive-supporting copy uses `text.primary`
  (`ink`), not `danger` — `danger` is reserved for the heading/label/short emphasis text where
  it does pass, never for longer explanatory sentences. `danger` may be used for icons,
  borders, accents, or controls only where the relevant text and non-text contrast
  requirements independently pass for that specific use. If red customer-facing text is
  genuinely required somewhere `danger` itself fails, a darker same-hue semantic `dangerText`
  token is proposed and verified before approval — not silently substituted with `danger`
  itself. **Every one of these pairings must be tool-verified before implementation** — the
  hand-calculated findings in `phase-8-visual-system-refinement.md` §24 are a first-pass
  estimate flagging real risk, not a certification.
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed correction to
  `docs/design/phase-8-visual-system-refinement.md` §24's contrast audit, which presented
  hand-computed WCAG estimates without a token-verification requirement or a semantic-role
  framing)
- **Reason:** a single pairing passing (e.g. `danger` at large/bold weight) does not make
  `danger` broadly safe — Phase 8's original framing risked being read as "danger is fine, just
  use it carefully," when the correct discipline is "each specific role/pairing is verified
  independently, and several already look likely to fail."
- **Alternatives considered:** treat Phase 8's hand-calculated numbers as sufficient and move
  on (rejected — explicitly what this decision corrects); silently swap all `danger` text to
  `ink` everywhere (rejected — over-corrects and removes legitimate, passing uses like
  large/bold destructive labels and tinted status pills).
- **Affected modules:** `docs/design/phase-8-visual-system-refinement.md` §4 (color-role
  table), §10 (button states), §11 (form error treatment), §24 (accessibility audit) — all
  amended in place; no code exists yet to verify against a real contrast tool.
- **Revisit trigger:** the first real accessibility/contrast-tool pass at implementation —
  this decision defines the *discipline*, not the final verified numbers.

## D35 — Provider-dependent payment copy remains an unresolved slot

- **Decision:** "Ready to pay" is the canonical readiness heading; "Pay now" is the canonical
  deliberate-entry action (both already established, D32/Phase 6 §24). The copy **inside**
  the focused payment-presentment module stays unresolved until the M0 provider gate
  determines the actually usable provider-supported method (G1). **"Pay at the register" is
  removed** as canonical or placeholder customer copy — it wrongly assumes an in-person
  transaction, which is not established. In internal specifications (this document and
  downstream visual/implementation docs), the unresolved module is represented with a
  clearly non-customer-facing marker: **`[provider-supported payment method]`**. No wallet,
  virtual-card reveal, register, online-checkout, tokenization, or credential-copy
  instructions are invented anywhere in the canonical copy system.
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed correction to
  `docs/design/phase-6-copy-system.md` §24's "Provider-dependent payment surface
  placeholders" entry, which had written "Pay at the register" as placeholder copy)
- **Reason:** "Pay at the register" silently assumed a specific transaction shape
  (in-person, physical register) that D32 explicitly declined to lock in — the M0 gate could
  resolve to an online/remote payment method just as easily, and placeholder copy that reads
  as a real, specific instruction risks being mistaken for a decided design rather than an
  open slot.
- **Alternatives considered:** write a provider-neutral placeholder sentence instead of
  removing customer-facing placeholder copy entirely (rejected — any customer-facing sentence
  describing *how* to pay implies a transaction shape; the only way to stay genuinely neutral
  is to mark the slot as unresolved in internal specs and write no customer copy for it at
  all until a provider is chosen).
- **Affected modules:** `docs/design/phase-6-copy-system.md` §16 (Ready-to-Pay entry copy)
  and §24 (screen deck's placeholder entry), amended in place; carries forward into Phase 8's
  Ready-to-Pay shell (§16 there) as a provider-independent visual shell around the same
  `[provider-supported payment method]` marker.
- **Revisit trigger:** M0 gate closure / provider selection (G1), same trigger as D32.

## D34 — Money-outcome language follows financial state, not audience

- **Decision:** equivalent financial outcomes use equivalent language across organizer,
  member, and guest experiences — money-outcome copy is chosen by **what happened to the
  money**, never softened or made warmer merely because the viewer is a guest. The canonical
  individual no-charge phrase is **"You weren't charged."** (replacing the audience-split
  "Nothing was charged" / "Nothing was taken" pair from `docs/design/phase-6-copy-system.md`
  §18/§25). The organizer's group-level equivalent may still be **"No one was charged."**
  (a genuinely different statement — about the group, not one individual). The other four
  canonical outcomes are preserved exactly: "Your payment is confirmed." / "Your payment is
  being returned." / "Your payment was returned." / **"We're resolving your payment. You
  don't need to pay again."** (the recovery-required line, now stated with its full
  reassurance clause fixed as part of the canonical phrase, not left implicit).
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed correction to
  `docs/design/phase-6-copy-system.md` §18/§25, which had introduced "Nothing was taken" as
  a guest-specific register of the same fact)
- **Reason:** Phase 6's own audience split, while internally consistent, violated the money-
  outcome standard's deeper intent — a guest's money is exactly as real as an organizer's,
  and giving guests warmer/less precise language for the same underlying fact reads as
  condescension once stated plainly, not care.
- **Alternatives considered:** keep the audience split as originally written (rejected —
  owner's explicit correction); use "No one was charged" for individuals too (rejected — it's
  factually a group statement and would misrepresent an individual-scoped outcome, e.g. a
  case where only one particular contribution needs describing).
- **Affected modules:** `docs/design/phase-6-copy-system.md` §18 (guest money-outcome
  matrix), §25 (money-outcome standard's phrase table), §24 (screen deck entries using the
  old guest phrase), amended in place.
- **Revisit trigger:** none expected.

## D33 — Contribution action is the confirmation; no separate confirmation sheet

- **Decision:** no separate VinkIn confirmation sheet is added before a member's or guest's
  contribution. The final amount-bearing action itself ("Pay $X" / "Approve $X") is the
  deliberate confirmation — the amount and its money consequence must already be visible
  before that action is tapped (already true today, Phase 4 §8/§9). A native
  provider/wallet confirmation may still occur later, once a real provider exists, but that's
  outside this UI's own confirmation surface. Contributions stay non-optimistic, idempotent,
  duplicate-tap protected, and are never automatically replayed after reload, reconnect,
  reauthentication, or restoration (all already established — D24/D25/D26,
  `docs/design/phase-5-button-interaction-contracts.md` C23–C25, C44).
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed — ratifies the interpretation
  `phase-5-button-interaction-contracts.md` §12 had already reached and flagged for
  confirmation: "adding a second confirm-before-authorize step would contradict 'one tap, one
  consequential request'")
- **Reason:** the amount-bearing action already carries full visible consequence; a second
  confirmation step would add friction without adding safety, and would contradict the
  one-tap-one-consequential-request principle already governing "Open Vink" (D30).
- **Alternatives considered:** add a confirmation sheet matching Open Vink's pattern
  (rejected — a contribution is naturally recoverable in a way opening a Vink is not: a
  declined attempt simply allows a new attempt, so the extra irreversibility safeguard Open
  Vink needs doesn't apply here).
- **Affected modules:** none in code yet; confirms
  `phase-5-button-interaction-contracts.md` §12's bottom-sheet inventory as settled, not
  merely proposed.
- **Revisit trigger:** none expected; would only be revisited if a future real provider
  requires its own mandatory confirmation step that changes this analysis.

## D32 — Deliberate Ready-to-Pay entry with provider-dependent presentment

- **Decision:** reaching `CARD_READY` never automatically reveals a sensitive payment
  instrument or initiates merchant payment. "Pay now" deliberately transitions the organizer
  into a **focused payment surface** — a distinct, dedicated screen/moment, not just an
  inline reveal within the Lobby. That surface must **eventually** provide an actually usable
  provider-supported presentment method; last-four digits and the spending limit may appear
  as safe summary information, but they are **not** a complete payment experience on their
  own. The canonical contract does **not** lock in wallet provisioning, full-card
  presentation, or any other specific provider-dependent method before the M0 provider gate
  resolves (`docs/architecture/06-milestone-0-gate.md`) — which method actually ships depends
  on which provider is chosen. If full virtual-card credentials are ever supported, they
  appear **only** inside the focused payment surface, only after the deliberate "Pay now" tap,
  remain masked until explicitly requested there, and **never** appear on Home, in Lobby
  progress, in Activity, or in Vink Details.
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed correction to
  `docs/design/phase-5-button-interaction-contracts.md` C31, which had provisionally
  specified a last-four-only inline reveal without flagging it as incomplete)
- **Reason:** C31 as originally written risked reading as a finished design when it's
  actually bounded by the still-open M0 provider gate — locking the canonical contract to
  "last four + spending limit, revealed inline" would either understate what a real payment
  experience needs, or accidentally commit to a specific provider shape before G1 (provider
  stack) resolves.
- **Alternatives considered:** fully specify a wallet-provisioning flow now (rejected —
  invents provider capability/wallet availability, explicitly excluded, and both the M0 gate
  and D15's own reasoning forbid designing a provider-shaped flow before a provider is
  chosen); leave C31 exactly as originally written (rejected — silently overstates a
  last-four reveal as a complete payment experience).
- **Affected modules:** `docs/design/phase-5-button-interaction-contracts.md` C31, amended in
  place; no code exists yet for any of this.
- **Revisit trigger:** M0 gate closure / provider selection (G1) — the focused payment
  surface's actual presentment method is designed then, against the real chosen provider's
  capabilities (`ProviderCapabilities`, D7).

## D31 — Customer-facing Activity detail is "Vink details," never "receipt"

- **Decision:** the D29 per-entry detail surface is named **"Vink details"** in every
  customer-facing label, never "Receipt" or "View receipt." Existing recorded Vink and
  contribution data (amounts, participants, outcome, timeline) may be shown as payment and
  outcome details, but never presented in a way that implies merchant-issued or
  provider-issued documentation — because no such artifact exists (the mock provider issues
  nothing a real merchant would recognize as a receipt, Phase 0 §10/§12). "Receipt"/"View
  receipt" language is reserved for if and when a real merchant/provider receipt artifact
  actually exists.
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed correction to `docs/design/phase-3-information-architecture.md`
  §4 and `docs/design/phase-4-screen-contracts.md` §11, both of which used "receipt"
  language for D29's screen)
- **Reason:** "receipt" implies a document issued by the merchant/payment provider attesting
  to a real transaction — VinkIn's own recorded data is real, but calling it a receipt
  overstates its provenance while the provider is still mocked (M0 gate open) and no
  merchant-issued artifact is ever captured or stored anywhere in the domain.
- **Alternatives considered:** "Receipt" (rejected — the naming issue this decision exists to
  fix); "Transaction detail" (rejected as needlessly technical/backend-sounding, inconsistent
  with the state-name-hiding discipline applied everywhere else).
- **Affected modules:** documentation only in this pass
  (`phase-3-information-architecture.md`, `phase-4-screen-contracts.md`); no code exists yet
  to rename.
- **Revisit trigger:** a real merchant/provider receipt artifact becomes available (ties to
  the M0 gate).

## D30 — Canonical Create flow is two input screens plus a transient confirmation, not a five-step wizard

- **Decision:** the canonical target Create flow is: (1) **Purpose and total**, entered
  together; (2) **People and split** (Equal/Custom only, D22), edited together; (3) a
  **transient Open Vink confirmation** — a bottom sheet, dialog, or equivalent safeguard, not
  a full page; (4) **Live Vink**. The standalone Review screen is removed as a destination —
  its content (the full allocation summary) is what the transient confirmation itself shows,
  not a separate step. The current five-step implementation
  (`apps/mobile/lib/features/create_vink/create_vink_screen.dart`) may remain documented as
  **current capability**, but is not the canonical target `docs/design/phase-3-information-architecture.md`
  §2 and `docs/design/phase-4-screen-contracts.md` §5 describe going forward.
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed correction to phase-3/phase-4)
- **Reason:** owner judged five sequential full-screen steps as more ceremony than the
  underlying task (a total, some people, a split) needs; collapsing to two substantive
  screens plus a lightweight, reversible confirmation reduces perceived setup cost without
  removing any real information from the flow.
- **Alternatives considered:** keep five steps as canonical (rejected — owner's explicit
  correction); collapse to one screen (not proposed — owner specified exactly two input
  screens plus the transient confirmation, not further collapse).
- **Affected modules:** documentation only in this pass; `apps/mobile`'s actual five-step
  wizard is unchanged code, now explicitly labeled as a current-capability description, not a
  target design.
- **Revisit trigger:** none expected.

## D29 — Activity gains a per-entry detail view ("Vink details," see D31)

- **Decision:** Activity's flat, non-interactive list becomes tappable — each entry opens a
  detail view built entirely from data already recorded (settlement, ledger, participant
  records, state history). No new financial concept and no new data capture; a
  presentation-only addition, addressing the "receipts and historical detail" requirement
  from the original UI/UX plan's Phase 3 outline, previously unmet
  (`docs/design/phase-3-information-architecture.md` §4 flagged this as undecided). **Named
  "Vink details," never "receipt" — see D31**, recorded immediately after this entry once the
  naming issue was caught.
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed)
- **Reason:** low risk — every field such a view would show already exists in the domain;
  it's a read, not a write, and touches no financial semantics.
- **Alternatives considered:** keep the flat list (rejected — owner resolved to add detail
  now, not defer further).
- **Affected modules:** `apps/mobile` (`activity_screen.dart` gains per-entry navigation to a
  new detail screen); a small application-layer read may be needed if today's `/activity`
  response doesn't already carry everything the detail view needs — an implementation detail
  for a later phase, not resolved here.
- **Revisit trigger:** none expected.

## D28 — Profile gains a minimal support-contact affordance; legal content stays deferred

- **Decision:** Profile adds a simple "Contact support" affordance (e.g. an email/link to
  whoever is staffing the PV12 pilot) — low-risk, low-effort, real value for real users
  hitting real problems. **No terms/privacy/legal content is added** — that requires actual
  legal review, not a UX decision, and stays deferred until counsel is engaged (ties to G2,
  MTL licensure, still open).
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed, resolving the gap
  `docs/design/phase-3-information-architecture.md` §5/§10 explicitly left open)
- **Reason:** owner distinguished "give users a way to reach a human" (a UX/operational need,
  safe to build now) from "publish legal terms" (needs real review, unsafe to fabricate).
- **Alternatives considered:** support + legal placeholders (rejected — legal placeholder
  copy risks looking like a real policy without real review); deferring both (rejected —
  owner chose to add support now).
- **Affected modules:** `apps/mobile` Profile screen (new support-contact row). Guest-web has
  no account/Profile surface at all, so this decision doesn't cover guest support contact —
  left as a residual, unscoped question, not decided here.
- **Revisit trigger:** before actual pilot launch — revisit whether legal content is needed
  once legal counsel is engaged.

## D27 — Members receive the same automatic SMS/email delivery as guests (amends D19)

- **Decision:** existing VinkIn members are notified of a new Vink the same way guests are
  (D19) — automatic SMS/email at the moment the Vink opens, through the same delivery
  pipeline. No separate in-app inbox or push-notification surface is being built for this
  redesign pass. This **amends D19's own text**, which said "existing members receive in-app
  invitations" — that described a surface that doesn't exist
  (`docs/design/phase-2-journey-architecture.md` §4 flagged this as an undecided gap); D19's
  member clause is now superseded by this decision, D19's guest clause is unchanged.
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed, resolving the gap phase-2-journey-architecture.md §4/
  §I.4 explicitly left open)
- **Reason:** owner chose one delivery mechanism over building two — avoids a second,
  parallel notification system (in-app inbox/push infra) when the SMS/email pipeline D19
  already requires can serve both audiences.
- **Alternatives considered:** in-app inbox/notification list (rejected — new screen + data
  model for a need the existing pipeline already covers once built); native push (rejected —
  heaviest new-scope option, needs APNs/FCM registration and a sending service); deferring
  indefinitely (rejected — owner resolved it now rather than leaving it open).
- **Affected modules:** none yet (blocked on the same D19 prerequisite — guest/member contact
  capture and an SMS/email delivery provider, neither built); `apps/mobile`'s
  `register_screen.dart` does not currently collect email in its UI at all (Phase 1 audit),
  so member delivery has the identical data-model gap guest delivery does.
- **Revisit trigger:** none expected; would only be revisited if the SMS/email delivery
  mechanism itself proves unsuitable for members specifically (e.g. a member update
  preference not to be texted).

## D26 — Organizer session expiry: in-place re-auth prompt, in-progress state preserved

- **Decision:** when an organizer's session is truly unrecoverable mid-use (refresh token
  itself dead — the one silent refresh-and-retry in `ApiClient` already failed), the app
  shows an in-place re-authentication prompt (modal/sheet) rather than a global redirect to
  Login. On successful re-auth, whatever screen/state the organizer was in (e.g. mid-way
  through the Create Vink wizard, or viewing a specific Lobby) resumes normally rather than
  being lost.
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed, resolving the gap
  `docs/design/phase-2-journey-architecture.md` §12/§I.4 explicitly left open)
- **Reason:** owner chose to preserve in-progress work over the simplicity of a global
  redirect — losing an organizer's half-completed Create-Vink wizard or their place in a live
  Lobby to a forced re-login is a worse experience than one extra re-auth step in place.
- **Alternatives considered:** global redirect to Login on any unrecoverable 401 (rejected —
  simpler to build, but discards in-progress state); deferring (rejected — owner resolved it
  now).
- **Affected modules:** `apps/mobile/lib/core/networking/api_client.dart` (`isAuthError` is
  defined at `api_exception.dart:11` but currently unconsumed anywhere — needs a global
  listener, not per-screen handling); `AuthController` needs a way to surface the prompt from
  any screen rather than only flipping state to `AuthSignedOut`; screens with meaningful
  in-progress local state (Create Vink wizard, Lobby) need that state to survive the
  interruption, which is a state-management requirement beyond just adding the modal.
- **Revisit trigger:** none expected.

## D25 — Guest terminal states must distinguish outcome, and a confirmed contribution is never re-offered

- **Decision:** guest-facing terminal/closed states must distinguish at least: **completed**
  (vink `COMPLETED`), **expired** (vink `EXPIRED`, guest never charged, or charged and
  refunded), **cancelled** (vink `CANCELLED`, guest never charged), **return pending** (the
  guest's own contribution is in `REFUND_PENDING` — money is coming back but hasn't yet),
  **returned** (the guest's own contribution reached `REFUNDED`), and **recovery-required**
  (vink `RECOVERY_REQUIRED`/`RECOVERY_PENDING` — organizer-only obligation; the guest's own
  contribution is already `SETTLED`, so this state means "nothing further is needed from you,"
  never a reason to withhold or recheck the guest's own payment status). A guest whose own
  contribution has already reached a confirmed state (`AUTHORIZED` or later in
  `packages/domain/src/contribution-state-machine.ts`) must never be shown the contribution
  action again after a reload, reconnect, or return visit.
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed)
- **Reason:** resolves the single highest-priority finding in
  `docs/design/phase-1-screen-audit.md` §C.11 — guest-web currently collapses every
  non-contributable state into one identical sentence and re-offers "Approve $X" to a guest
  who already paid, because the UI has no per-guest payment-outcome signal and falls back to
  an ephemeral, reload-resetting local flag.
- **Alternatives considered:** keep a single generic "no longer accepting contributions"
  message and rely on copy alone to soften it (rejected — a generic message cannot say
  whether the guest's own money is safe, which is the actual anxiety at stake); infer outcome
  client-side from vink state alone (rejected — vink state doesn't tell a guest whether
  *their own* contribution was captured, refunded, or never charged, only what the whole
  session did).
- **Affected modules:** requires a new viewer-specific field on the guest read model (see
  D24) — `packages/application/src/guest.ts` (`GuestVinkView`), `apps/guest-web` (`SessionView.tsx`,
  `lib/types.ts`). No change to `packages/domain`'s state machines themselves.
- **Revisit trigger:** none expected.

## D24 — Both clients consume a server-provided `contributionProgress` projection; guest responses add viewer-specific contribution status

- **Decision:** the API exposes a `contributionProgress` projection — `{ confirmedAmountMinor,
  totalAmountMinor, confirmedParticipantCount, totalParticipantCount }` — computed from
  participant assigned shares and each contribution's current state (a contribution counts as
  "confirmed" once it reaches `AUTHORIZED` or later in the contribution state machine, i.e.
  the participant's payment is no longer at risk of silently vanishing, even before the
  session-wide capture in `resolveFunding`). Both `apps/mobile` and `apps/guest-web` consume
  this projection for any incremental progress UI (the Ink Progress System, D20) instead of
  each computing their own approximation. Guest-facing responses additionally carry a
  **viewer-specific** `contributionStatus` field (the requesting guest's own contribution
  state, collapsed to a small UI vocabulary — see D25) so the web experience can tell *this
  guest's own outcome* apart from the group's aggregate progress, without exposing any other
  participant's individual payment state (Phase 0's guest/member capability boundary is
  unchanged — a guest still cannot see anyone else's payment status, only the aggregate
  counts and their own).
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed)
- **Reason:** D20 already established that `fundedAmount` must not drive incremental
  progress; this decision fixes the *shape* of its replacement so both clients converge on
  one server-computed projection instead of two independently-invented client-side
  approximations (mobile already has `contributionStatusByParticipant` per-row data;
  guest-web has no equivalent field at all — Phase 1 §C.8/§C.11), and adds the one thing
  neither client can derive locally: which state *this specific viewer's own* contribution is
  in, persistent across reload.
- **Alternatives considered:** let each client independently derive progress from whatever
  participant data it already has (rejected — guest-web has no per-participant data to derive
  from at all, and independent derivation on two platforms risks the exact kind of drift D20
  was written to prevent); expose full per-participant contribution detail to guests
  (rejected — violates the existing guest/member privacy boundary from Phase 0 §2 for no
  product benefit; a guest only ever needed to know the aggregate and their own status).
- **Affected modules:** new read in `packages/application` (likely alongside/replacing
  `VinkReader.listContributionsByVink`, `packages/application/src/queries.ts`); response
  shape changes in `apps/api` for both the organizer snapshot and `GuestVinkView`; consuming
  changes in `apps/mobile` and `apps/guest-web`. No change to `fundedAmount`, the ledger, or
  the D5 resolver.
- **Revisit trigger:** none expected.

## D23 — Guests never see DRAFT; automatic invitations send only at Vink-open; a valid pre-open link shows a distinct "not open yet" state

- **Decision:** the internal `DRAFT` state must never be visible to a guest, in any form —
  not the raw name, not a synonym badge. Automatic guest invitations (D19) are sent only at
  the moment a Vink transitions `DRAFT → OPEN` (the `VINK_OPENED` event,
  `packages/domain/src/vink-state-machine.ts:77`), never earlier. If a guest reaches a valid,
  manually-shared link before that transition (the organizer shared it early, or a guest
  revisits a link generated during Create-Vink), the guest sees a customer-facing **"This
  Vink isn't open yet"** state with no contribution action available, and the screen
  transitions automatically (via the existing realtime channel, no manual refresh) the moment
  the Vink opens.
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed)
- **Reason:** closes Phase 1's highest-severity hard-rule violation (§C.4/§E.1 — a guest
  could see a literal "Draft" badge, and separately a misleading "no longer accepting
  participants" message for a Vink that was never open in the first place, §D.2). Fixing only
  the badge label would leave the state itself guest-visible in spirit even if not by name;
  the decision requires the pre-open moment to read as "not yet," never as an backend-state
  synonym or a false "closed" message.
- **Alternatives considered:** keep showing the vink summary (organizer, purpose, amount)
  pre-open and just relabel the badge (rejected — still exposes DRAFT-stage information the
  organizer may not have finished configuring, e.g. a split not yet finalized); block the
  link from resolving at all pre-open with a 404-style response (rejected — indistinguishable
  from an invalid/expired link, worse for a legitimate early visitor than a clear "not open
  yet" state).
- **Affected modules:** `packages/application/src/guest.ts` (`getPublicVinkView` needs a
  state-gated response shape, not just a UI change); `apps/guest-web`
  (`JoinExperience.tsx`/`JoinForm.tsx`); `apps/mobile` (link-sharing UI should make clear a
  shared link won't work for guests until the Vink is opened).
- **Revisit trigger:** none expected.

## D22 — Percentage splitting stays hidden from the MVP UI (intentional scope decision)

- **Decision:** `PERCENTAGE` split remains fully implemented in
  `packages/domain/src/split-engine.ts` and accepted by `setSplitCommand`/
  `PUT /vinks/:vinkId/split`, but the redesign's Phase 1 audit and all downstream UI work
  expose only `EQUAL` and `CUSTOM_AMOUNT` in the Flutter organizer split step. This is a
  deliberate MVP scope decision, not an unresolved gap or a backend limitation.
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed)
- **Reason:** owner confirmed PV13's existing UI omission as the intended MVP surface rather
  than an oversight to fix; keeps the split step to two clearly understood options for
  first-time users.
- **Alternatives considered:** exposing Percentage now (rejected — no product need identified
  yet; can be added later with zero backend change since the capability already exists).
- **Affected modules:** `apps/mobile` split screen only; no backend change.
- **Revisit trigger:** a specific product request for percentage-based splitting.

## D21 — No fee model is canonical; UI must not display, calculate, or hard-code a fee

- **Decision:** VinkIn currently has no fee model anywhere in the domain. Phase 1 of the
  UI/UX redesign, and all work downstream of it, must not display, calculate, or hard-code
  any guest/participant fee. Payment-summary components may include an optional slot for a
  future API-provided fee value, but it must stay absent/hidden while no real fee exists —
  never populated with placeholder or estimated numbers.
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed)
- **Reason:** prevents the redesign from inventing financial terms that don't exist in the
  product, which would misrepresent real costs to users; keeps the door open for a real fee
  model later without a UI rework.
- **Alternatives considered:** designing a placeholder fee line now for future use (rejected —
  risks shipping a false number if the optional slot gets wired before a real fee model
  exists).
- **Affected modules:** `apps/guest-web` payment summary, `apps/mobile` contribution screens
  (design only; no backend change).
- **Revisit trigger:** a fee model actually being added to the domain.

## D20 — Ink Progress System is driven by `contributionProgress`, not `fundedAmount`

- **Decision:** the redesign's Ink Progress System represents contribution *readiness* — how
  much of participants' assigned shares have reached a confirmed contribution state — not the
  backend's `fundedAmount`/`fundedAmountMinor` field, which stays exactly as implemented
  today (single atomic update at full resolution, per D5). Phase 1 must derive an incremental
  progress value from participant assigned shares and confirmed contribution states (the same
  underlying data PV13's `VinkReader.listContributionsByVink` already exposes), and name this
  UI-level concept `contributionProgress` or an equivalent name that cannot be confused with
  settled/fully-funded money. `fundedAmount` itself is not redefined or changed.
- **Date:** 2026-07-20
- **Status:** ACCEPTED (owner-directed)
- **Reason:** resolves the conflict flagged in `docs/design/phase-0-product-behavior.md` §6
  between the Ink Progress System's "each confirmed contribution raises the ink smoothly"
  requirement and `fundedAmount`'s all-at-once resolution, without touching the D5
  single-resolver funding semantics.
- **Alternatives considered:** changing the resolver to update `fundedAmount` incrementally
  (rejected — would touch §18 ledger/funding logic and the D5 single-resolver invariant for a
  UI-only need).
- **Affected modules:** none in `packages/domain`/`packages/application` state machines; a new
  derived UI-layer read, likely alongside or extending `VinkReader.listContributionsByVink`
  (`packages/application/src/queries.ts`).
- **Revisit trigger:** none expected; would only be revisited if a future decision changes how
  `fundedAmount` itself is computed.

## D19 — Automatic SMS/email guest invitation delivery is canonical product behavior

- **Decision:** automatic guest contact is the intended final product behavior, not an
  optional enhancement. ~~Existing VinkIn members receive in-app invitations.~~ **Superseded
  by D27 (2026-07-20): members receive the same automatic SMS/email delivery as guests,
  through the same pipeline — no separate in-app invitation surface.** Guests (no account)
  receive an SMS or email invitation automatically, unless the organizer explicitly chooses
  manual sharing instead. Copy Link, Share (OS share sheet), and QR remain supported as
  fallback/manual delivery methods, available in every case regardless of the automatic path.
  The current manual-only delivery (documented in `docs/design/phase-0-product-behavior.md`
  §4 and PV4's known limitations) is recorded as an **implementation gap against this
  decision**, not the intended final workflow.
- **Date:** 2026-07-20 (member clause superseded 2026-07-20 by D27)
- **Status:** ACCEPTED (owner-directed); implementation not yet built. This resolves G12
  (notification channels) in `docs/spec/open-questions.md` — see that file's Resolved table.
  The SMS/email delivery mechanism itself (provider selection, templates, retry/failure
  handling) is a separate, not-yet-scoped build item.
- **Reason:** owner confirmed automatic delivery is the intended product experience —
  organizers should not have to personally relay every invitation by hand as the default
  path.
- **Alternatives considered:** manual-first with automatic delivery as a future enhancement
  (rejected — owner wants automatic delivery treated as canonical now, informing the
  redesign's information architecture, even though it isn't built yet).
- **Affected modules:** none yet in `apps/api`/`packages` (no SMS/email provider integration
  exists); affects the Phase 1 audit's findings and later screen/copy design for invitation
  flows in `apps/mobile` and `apps/guest-web`.
- **Revisit trigger:** SMS/email provider selection and integration (a new build item, not
  scoped here).

## D18 — Funnel analytics: instrument only what persisted state can't already show

- **Decision:** the PV12 exit gate names six numbers (≥25 completed Vinks, ≥75 participant
  joins, ≥80% organizer task completion, median join-to-contribution time, top five failure
  points, no unresolved critical defects). Four of the five measurable ones are computed
  directly from existing tables (`vinks`, `participants`, `contributions`) at query time —
  no client instrumentation. A new `analytics_events` table (migration 0008) and public
  ingestion endpoint (`POST /api/v1/analytics/events`) exist for exactly the one thing
  persisted state structurally cannot show: where someone abandoned or hit an error *before*
  anything was written to the database (a guest who saw "no longer accepting participants"
  and left; an organizer whose create-Vink form failed validation). Both client apps
  (`apps/guest-web`, `apps/mobile`) report a small, named set of funnel-entry and `_failed`
  events; the operations console's `/analytics` page (PV11) surfaces all six numbers
  together with the pilot's own thresholds.
- **Date:** 2026-07-19
- **Status:** PROPOSED
- **Reason:** the owner asked specifically for "funnel analytics instrumentation" toward
  PV12 without specifying event taxonomy or an analytics vendor. Duplicating
  already-persisted facts (a completed Vink, a joined participant) as client events would
  be redundant and could drift from the database's own truth; instrumenting only
  client-side failure/abandonment moments adds real, non-duplicated value without inventing
  an event schema broader than the exit gate actually needs.
- **Alternatives considered:** a full page-view/interaction event stream (rejected —
  matches neither "avoid a broad admin platform" from D17's brief nor any named PV12
  requirement beyond the six numbers); a third-party analytics SDK (rejected, same reasoning
  as the `DebugAnalytics` stub already in place since PV9 — no vendor has been chosen, same
  spirit as the payment-provider boundary, D10).
- **Affected modules:** `apps/api/src/modules/analytics/*`, `apps/api/src/modules/ops/analytics.ts`,
  `apps/guest-web/lib/analytics.ts`, `apps/mobile/lib/core/analytics/analytics.dart`,
  `apps/operations-console/app/analytics/`.
- **Revisit trigger:** if the actual PV12 pilot run finds the failure-point taxonomy too
  coarse to diagnose real issues, or an analytics vendor gets chosen for a later phase.

## D17 — Operator identity for the PV11 operations console: shared password, named per session

- **Decision:** the ops console (`apps/operations-console/`) is not a new user/role in the
  existing `users` table. An operator logs in with a free-text **name** (for audit
  attribution) plus a single shared secret from `env.OPERATOR_PASSWORD`, checked at
  `POST /internal/ops/auth/login`. Success mints a short-lived signed token
  (`kind: 'operator'`, embedding the name, reusing `JWT_SECRET`) that every other
  `/internal/ops/*` route requires. Every ops-console action that mutates anything
  (merchant-authorization, capture, run-deadlines, resolve-pending) writes a row to a new
  `operator_audit_log` table naming the operator, the action, and its target — satisfying
  Spec §21's "record operations-console actions in an audit log" without inventing a
  multi-operator account/role/permission system the Spec never asked for.
- **Date:** 2026-07-19
- **Status:** PROPOSED
- **Reason:** the Spec and master plan name "an operator" throughout (§21, PV11 exit gate)
  but never define what an operator account is, and governance doc 00 only says PV11 access
  is "operator-only" in the `demo` environment without specifying how that's enforced. A
  full operator-account system (its own table, roles, password reset, invitations) is
  exactly the kind of scope the owner's PV11 brief explicitly warned against ("avoid turning
  PV11 into a broad internal admin platform"). A single shared credential is the minimum
  that (a) genuinely gates access, (b) lets every action be attributed to a name for the
  audit log, and (c) matches this milestone's actual need — a handful of trusted people
  operating one pilot, not a multi-tenant admin product.
- **Alternatives considered:** reusing the `users` table with an `is_operator` flag
  (rejected — pulls operators into the same identity system as organizers/participants,
  which the Spec treats as a different trust boundary, for no benefit at this scale);
  per-operator accounts in a new table (rejected as premature — nothing in PV11's scope
  needs to distinguish *which* trusted person is on shift beyond what they type into the
  audit log).
- **Affected modules:** `apps/api/src/modules/ops/*` (new), `apps/operations-console/`.
- **Revisit trigger:** PV12 (a real pilot, multiple operators on rotating shifts) if
  attribution-by-typed-name proves too weak in practice; certainly before any
  production/real-money environment, where shared credentials are a non-starter regardless.

## D16 — Production-shaped realtime fanout: Redis-backed hub, in-process retained for tests

- **Decision:** `apps/api/src/realtime/hub.ts` exposes a `RealtimeHub` interface with two
  implementations: `RedisRealtimeHub` (ioredis pub/sub — one publish connection, one
  dedicated subscriber connection, reference-counted local channel subscriptions) used by
  `server.ts`, and `InProcessRealtimeHub` (the original PV8 implementation) kept for unit
  tests that don't need infrastructure. The outbox publisher (`outbox-publisher.ts`) was
  hardened alongside this: `SELECT … FOR UPDATE SKIP LOCKED` lets multiple API instances
  poll concurrently without double-claiming rows, and the provider-neutral pattern from
  D12/§12 applies — publish-then-commit, so a crash between them causes at most a harmless
  duplicate delivery (at-least-once, idempotent consumers), never a lost one.
- **Date:** 2026-07-18
- **Status:** ACCEPTED (owner-directed: "settle both now" — formal PV8.5 milestone)
- **Reason:** the PV8 hub was explicitly flagged single-process-only; multiple API
  instances (any real deployment beyond a single validation-pilot box) need a shared
  fanout or WebSocket clients on different instances silently miss events.
- **Alternatives considered:** PostgreSQL LISTEN/NOTIFY (rejected: payload size limits and
  no reference-counted subscription primitive; revisit if Redis becomes undesirable);
  keeping single-process and documenting it as a pilot-only limitation (rejected — the
  owner asked to settle it, and Redis is already a required dependency via BullMQ).
- **Affected modules:** `apps/api/src/realtime/*`, `server.ts`.
- **Revisit trigger:** none expected; LISTEN/NOTIFY reconsidered only if Redis is dropped
  as an infra dependency entirely.

## D15 — Provider-calls-inside-transaction pattern ratified as intentional for the mock build

- **Decision:** `contributions.ts`, `purchases.ts`, and `recovery.ts` call
  `FinancialProvider` methods **inside** the PostgreSQL row-locked transaction that also
  writes domain state. This was flagged (not silently carried) in each module's header
  since PV5. It is now formally **ratified as correct for the validation build** rather
  than rewritten into a two-phase (reserve → external call outside any transaction →
  record result) pattern, for a reason rooted in project scope, not convenience: the
  *shape* of a correct two-phase design depends on the real provider's own idempotency and
  webhook semantics (Stripe's differ meaningfully from Lithic's), which are unconfirmed
  while the M0 gate is open. The gate's own rule — "anything whose shape would change if
  condition 1 or 2 came back 'no' is forbidden until those conditions are met"
  (`docs/architecture/06-milestone-0-gate.md`) — applies here: building speculative
  two-phase provider orchestration now risks guessing a design the real adapter discards.
  The mock provider is in-process and synchronous, so no external-call risk (timeout,
  partial failure independent of the DB transaction) actually exists today to harden
  against.
- **Date:** 2026-07-18
- **Status:** ACCEPTED (owner-directed scoping decision, made explicit rather than silently
  deferred — Spec §9)
- **Reason:** see above; distinguishes "flagged and consciously deferred with a named
  trigger" from tech debt silently carried forward.
- **Alternatives considered:** speculative two-phase rewrite now (rejected: guesses a
  provider-specific design before a provider is chosen, contradicts the M0 gate's own
  boundary, and risks the ~110 tests across PV5–PV7 for unproven value); do nothing /
  leave the flag unresolved (rejected: the owner asked to settle it — this makes the
  scoping decision explicit and owner-visible instead).
- **Affected modules:** `packages/application/src/{contributions,purchases,recovery}.ts`
  (comments updated to point here instead of a vague "D10 revisit").
- **Revisit trigger:** M0 gate closure and the first real-adapter design review
  (master plan §28) — the two-phase pattern is designed then, against the actual chosen
  provider's semantics, not before.

## D14 — Validation-build guest token design (PV4 subset of G4)

- **Decision:** guest join mints one opaque token (`vgt_` + 32 random bytes, base64url) per
  join; only its SHA-256 hash is stored (`guest_identities.access_token_hash`, UNIQUE). One
  guest identity binds to exactly one participant slot (partial UNIQUE index — G4's
  "single-slot binding"). Expiry: 7 days from join (covers post-completion status screens).
  The raw token appears exactly once, in the join response. Public surfaces
  (`GET /join/:code`, guest join) are rate-limited per IP (in-memory fixed window;
  Redis-backed when horizontal scale arrives).
- **Date:** 2026-07-18
- **Status:** PROPOSED (engineering default for the mock-money build; G4's production
  questions — verification factor, SMS OTP amount threshold, production TTL — remain OPEN
  and are re-decided before real money at M4)
- **Reason:** Plan §21 mandates hashed guest tokens and rate-limited public joins; no real
  money means no OTP requirement yet.
- **Alternatives considered:** JWT guest tokens (rejected: revocation and single-slot
  binding are simpler with a hashed opaque token); 15-minute TTL per G4's proposed default
  (rejected for the validation build: guests must reopen their status screen across the
  session's whole life).
- **Affected modules:** `packages/application` (guest.ts), `apps/api` (guest-tokens,
  sharing routes, migration 0003).
- **Revisit trigger:** M4 entry (real-money guest checkout) or pilot feedback on token
  lifetime.

## D13 — Command model: all business behavior is an explicit application command

- **Decision:** no transport (HTTP handler, WebSocket, CLI, job) may mutate a domain
  aggregate directly. Every business action is an application-layer command
  (`OpenVinkCommand`, `JoinVinkCommand`, `AuthorizeContributionCommand`, …) with one shape:
  validate → load aggregate → execute transition → emit event → return aggregate. Endpoints
  are transport bindings to commands, nothing more (owner's PV3 refinement: Flutter calls
  `OpenVinkCommand` through the application layer, not `POST /vinks/:id/open` semantics).
- **Date:** 2026-07-17
- **Status:** ACCEPTED (owner-directed)
- **Reason:** keeps provider replacement and transport changes trivial; one auditable path
  for every state change (pairs with D12).
- **Alternatives considered:** route-handler orchestration (rejected: scatters invariants
  across transports).
- **Affected modules:** future `packages/application` (PV3+); PV1 identity endpoints predate
  the financial aggregates and are brought under commands when the application layer lands.
- **Revisit trigger:** a command that cannot fit the five-step shape.

## D12 — Every successful state transition atomically produces its domain event

- **Decision:** a state transition and its domain event are inseparable. In code,
  `transitionVink` / `transitionContribution` return `{ to, emits }` — the transition table
  itself names the event, so a silent transition is unrepresentable. In persistence (PV3+),
  the state write and the outbox insert commit in the same transaction (Plan §12).
- **Date:** 2026-07-17
- **Status:** ACCEPTED (owner-directed)
- **Reason:** analytics, notifications, and replay all need a complete event stream; an
  optional event is eventually a missing event.
- **Naming note (flagged, not silent):** events use the Plan §12 catalog names — the owner's
  illustrative `CardProvisioningStarted` is realized as the catalog's
  `TemporaryCardRequested`. Additive catalog extensions required for full coverage (marked
  in `packages/domain/src/domain-events.ts`): `MerchantAuthorizationReversed`,
  `ContributionCaptureStarted`, `ContributionCancellationStarted`, `ContributionCaptured`,
  `ContributionCancelled`, `ContributionSettled`, `RefundFailed`, and (PV3)
  `ParticipantRemoved`.
- **Affected modules:** `packages/domain` (implemented), future outbox wiring (PV3+).
- **Revisit trigger:** an event catalog change in a future plan revision.

## D11 — PV state-machine vocabulary diverges from doc 03; PV governs the validation build

- **Decision:** the validation build implements the master plan's §8/§9 machines verbatim
  (`OPEN`, `PROCESSING_GRACE` → `FUNDED`/`EXPIRED`, `CARD_PROVISIONING`/`CARD_READY`,
  `PURCHASE_AUTHORIZED`, `SETTLING`, …) in `packages/domain`. The Spec-derived machines in
  `docs/architecture/03-state-machines.md` (`READY`/`LIVE`, `EVALUATING`/
  `PROVIDER_RECONCILIATION`, `SPEND_PREPARATION`/`CARD_ACTIVE`, …) remain the production-track
  reference. The two must be reconciled into one vocabulary **before** provider integration
  begins (M0 gate closure is the trigger).
- **Date:** 2026-07-17
- **Status:** ACCEPTED AS AMENDED (owner, 2026-07-17): the PV plan's state names are
  **canonical everywhere** — one ubiquitous language. Doc 03 rewritten to the canonical
  vocabulary; the alternate vocabulary (`READY`/`LIVE`, `EVALUATING`/
  `PROVIDER_RECONCILIATION`, `SPEND_PREPARATION`/`SPEND_READY`/`CARD_ACTIVE`, …) is retired.
  Documentation adapts to the code, not the other way around. The G13 edge interpretations
  were ratified as implemented in the same review. Historical docs (doc 00, D5/D6 entries)
  keep their original wording as dated records with a supersession note.
- **Reason:** the owner-directed PV plan is explicit and simpler (mock-only build has no
  provider-reconciliation phase); silently merging the two vocabularies would be a silent
  spec change. D5's single-resolver rule is preserved: one resolver decides
  FUNDED/EXPIRED exactly once out of PROCESSING_GRACE.
- **Alternatives considered:** implement doc 03's machines instead (rejected: contradicts the
  owner's verbatim directive); merge on the fly (rejected: silent change).
- **Affected modules:** `packages/domain`, future PV3+ application services.
- **Revisit trigger:** M0 gate closure / first real adapter design review.

## D10 — Product-validation (PV) track adopted alongside the M0 gate

- **Decision:** the owner's Provider-Neutral Product Validation Build plan
  (`docs/product-validation/master-plan.md`, PV0–PV12) is adopted as the active engineering
  track while the M0 gate remains open. All PV work is mock-backed and provider-neutral;
  gate-boundary interpretations are recorded in
  `docs/product-validation/00-governance.md` §1 (mock card/settlement flows permitted;
  validation-build ledger DDL is not "production ledger migrations"; provider integration
  still requires the ten-condition gate).
- **Date:** 2026-07-17
- **Status:** ACCEPTED (owner-directed); gate-boundary interpretations **RATIFIED by the
  owner 2026-07-17** — mock card/settlement/authorization/refund flows are domain concepts,
  not provider concepts; provider swap later touches only the adapter
- **Reason:** validate the product with real users before a provider is confirmed, without
  building anything whose shape depends on unconfirmed funds flow.
- **Alternatives considered:** wait for provider answers before building (rejected by owner:
  product risk is testable now); build against Stripe sandbox speculatively (rejected:
  exactly what the M0 gate forbids).
- **Affected modules:** milestone sequencing (PV0–PV12 interleaved before M1+), new
  `packages/domain`, CI (provider-import guard).
- **Revisit trigger:** any M0 gate answer that invalidates the mock card/settlement model.

## D9 — Repository relocation to `~/code/vinkin`

- **Decision:** move the repo out of `~/Downloads/Vinkin - v1` (space in path, volatile
  location, unrelated `CLAUDE.md` in parent) to `~/code/vinkin` before further tooling lands.
- **Date:** 2026-07-16
- **Status:** ACCEPTED (owner-directed); execution pending — owner performs the move + git init
- **Reason:** stable lowercase path prevents breakage in shell scripts, CI, Docker mounts,
  agent sessions.
- **Alternatives considered:** stay in place (rejected: every future artifact would embed a
  fragile path).
- **Affected modules:** none in-repo (no absolute paths are committed anywhere).
- **Revisit trigger:** none.

## D8 — Formal ten-condition M0 gate

- **Decision:** M0 closes only via the evidence-linked gate in
  `docs/architecture/06-milestone-0-gate.md`; it defines permitted vs. forbidden work while
  open.
- **Date:** 2026-07-16
- **Status:** ACCEPTED (owner-directed)
- **Reason:** "wait for Stripe" is not auditable; conditions + written evidence are.
- **Alternatives considered:** informal exit list in the feasibility doc (superseded).
- **Affected modules:** milestone sequencing; feasibility docs.
- **Revisit trigger:** any gate condition proving impossible to evidence in writing.

## D7 — Shared provider conformance suite + explicit `ProviderCapabilities`

- **Decision:** every `FinancialProvider` adapter must pass
  `packages/payment-provider-contract-tests`; adapters declare a ten-flag
  `ProviderCapabilities` object and the application branches on flags, never on assumptions.
- **Date:** 2026-07-16
- **Status:** ACCEPTED (owner-directed)
- **Reason:** Spec §21 "do not assume those features are universally available"; §9 fallback
  visibility.
- **Alternatives considered:** per-adapter ad hoc tests (rejected: drift), capability probing
  at runtime (rejected: hides program-level facts).
- **Affected modules:** `payment-provider`, all future adapters, payment orchestrator (M5+).
- **Revisit trigger:** a capability that can't be expressed as a boolean (then evolve the
  shape via a new decision).

## D6 — Authorization-expiry status `EXPIRED` added to the neutral status set

- **Decision:** provider payment statuses include `EXPIRED` (hold lapsed before
  capture/cancel), distinct from `CANCELED`.
- **Date:** 2026-07-16
- **Status:** ACCEPTED
- **Reason:** §21 warns holds don't survive days; orchestrator must distinguish "we released
  it" from "it lapsed" for §25 messaging and reconciliation.
- **Alternatives considered:** fold into CANCELED with a reason field (rejected: reconciliation
  sweeps need the distinction first-class).
- **Affected modules:** `payment-provider`, future M5 contribution engine.
- **Revisit trigger:** provider evidence that expiry is not observable as a distinct state.

## D5 — `EVALUATING` is the zero-length fast path of the single session resolver

- **Decision:** Spec §13's `SUBMISSIONS_CLOSED → EVALUATING` (no unresolved attempts) and the
  §14 grace path run the same resolver code under the same vink row lock; the funding
  decision happens exactly once.
- **Date:** 2026-07-16
- **Status:** ACCEPTED (interpretation; flagged in doc 00 §2.3.1)
- **Reason:** §14 requires expiry worker and webhook processor to share one locking strategy.
- **Alternatives considered:** two code paths (rejected: the race between them is exactly the
  bug class §14 exists to prevent).
- **Affected modules:** vinks module (M3/M5).
- **Revisit trigger:** owner reading of §13 differs.

## D4 — Membership states live on `vink_members`; contribution slots are purely financial

- **Decision:** §11's INVITED/JOINED vocabulary is membership, not payment; slots begin at
  `PAYMENT_NOT_STARTED`. API responses may still project the combined §11 vocabulary.
- **Date:** 2026-07-16
- **Status:** ACCEPTED (interpretation; flagged in doc 00 §2.3.2)
- **Reason:** one aggregate per concern; removal rules (§15) act on membership, capture rules
  on slots.
- **Alternatives considered:** one merged state machine (rejected: forces illegal-transition
  handling for orthogonal concerns).
- **Affected modules:** vinks + contributions modules, DB schema doc §2/§3.
- **Revisit trigger:** API design review in M3.

## D3 — `parseWebhookEvent` added to the §43 interface

- **Decision:** the provider interface carries webhook signature verification + event
  normalization.
- **Date:** 2026-07-16
- **Status:** ACCEPTED (additive extension; flagged in doc 00 §2.3.4)
- **Reason:** §28 mandates signature verification, which is provider-specific by nature.
- **Alternatives considered:** separate `WebhookVerifier` interface (rejected for V1: one
  provider surface, one adapter object).
- **Affected modules:** `payment-provider`, webhooks module (M5).
- **Revisit trigger:** an adapter whose webhook handling can't be expressed in this shape.

## D2 — Ledger tables land in Milestone 5; M6 is projections + reconciliation

- **Decision:** `ledger-core` package and `ledger_*` DDL ship with the contribution engine
  (M5), because §26/§27 make capture confirmation and ledger posting one transaction.
- **Date:** 2026-07-16
- **Status:** ACCEPTED (owner review 2026-07-16 endorsed; flagged in doc 05 §1)
- **Reason:** M5 cannot exist without postings; only the milestone label moves, no scope.
- **Alternatives considered:** stub postings in M5 (rejected: violates §27 atomicity from day
  one).
- **Affected modules:** ledger, contributions.
- **Revisit trigger:** none.

## D1 — Monorepo tooling: pnpm workspaces + turborepo; Flutter outside the JS workspace

- **Decision:** as titled; details in `docs/architecture/01-monorepo-structure.md`.
- **Date:** 2026-07-16
- **Status:** ACCEPTED
- **Reason:** strict dependency isolation (protects §43 provider boundary), cached CI.
- **Alternatives considered:** npm workspaces (weaker isolation), Nx (heavier than needed),
  melos-managed Flutter inside the workspace (pretends Dart is a JS package).
- **Affected modules:** all, from M1.
- **Revisit trigger:** M1 retro if CI times or DX disappoint.
