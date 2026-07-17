# Glossary

Terms as used in this repo. Spec § references point at `master-roadmap-prompt.md`.

## Product

- **Vink** — one collaborative checkout session for one purchase; exists only through purchase
  + settlement (§4.3).
- **Organizer** — the verified user who starts a Vink, controls the temporary card, and is
  accountable for settlement adjustments (§4.8–9).
- **Participant** — a group member funding a share; never chargeable beyond their explicitly
  approved maximum (§4.7).
- **Guest** — a participant paying via QR + mobile web with no app or account (§10.4).
- **Cover Remaining** — organizer fallback that instantly funds the unpaid balance (§15).
- **Temporary Vink Card** — single-Vink, amount-capped virtual card; hidden after first use;
  closed after clearing (§3.2).

## Sessions & money

- **Contribution slot** — a member's immutable financial obligation in a Vink: base amount +
  maximum, per split version (§11).
- **Contribution attempt / attempt generation** — one provider payment try against a slot;
  generation increments only on definitive decline (§11–§12).
- **Split version** — immutable snapshot of the allocation; every change appends a new
  version (§15).
- **Processing grace** — post-timer window where pre-cutoff attempts may resolve; no new
  submissions (§14).
- **Session resolver** — the single locked code path that decides FUNDED/EXPIRED exactly once
  (docs/architecture/03 §1, D5).
- **Funding decision** — the exactly-once FUNDED-or-EXPIRED outcome of the resolver.
- **Slippage** — small configured overage allowed on an EXACT_FINAL card above the funded
  total; never spread across participants (§20).
- **Settlement adjustment** — merchant settled above group funding; typed (§22) and owed by
  the responsible party, usually the organizer.
- **Recovery obligation** — organizer debt from an adjustment, charged to their recovery
  method under a retry policy (§23).
- **Recovery method** — reusable payment method organizers must register before starting
  Vinks (§23).
- **Reimbursement request** — organizer asking original participants to repay a covered
  share; versioned allocations, consent required, never auto-recursive (§24).

## Cards & network

- **Merchant lock** — after the first approved authorization the card only accepts that
  merchant's related activity (§18).
- **MCC** — Merchant Category Code; network-reported merchant type, the enforcement signal
  vs. the organizer's selected category (§19).
- **Policy family** — internal payment policy behind user categories: `EXACT_FINAL`,
  `RESTAURANT_VARIABLE`, `VARIABLE_SETTLEMENT_UNSUPPORTED` (§5.2).
- **Authorization decision** — VinkIn's real-time approve/decline on a card authorization,
  recorded immutably (§17).
- **Duplicate classification** — §17 vocabulary: duplicate retry / reversal-and-retry /
  incremental / partial / related / unrelated.
- **Purchase destination** — the seam that lets a Vink pay via temporary card today,
  merchant API later (§42; docs/architecture/02 §5).

## Platform & correctness

- **Operation identity** — server-derived stable idempotency key
  (`authorize:v1:{slot}:{gen}`, …); the only legal key format (§12).
- **Ledger** — append-only double-entry record in integer minor units; the financial source
  of truth (§26); balance + immutability enforced by DB triggers.
- **Reversal** — the only legal correction: a new balancing transaction, never an edit (§26).
- **Outbox** — events written in the same transaction as state changes; the only
  cross-module signal (§29).
- **Provider event inbox** — raw webhook store deduped on `(provider, provider_event_id)`;
  decisions use provider `occurred_at`, never arrival time (§28).
- **Provider capabilities** — an adapter's honest ten-flag declaration; the app branches on
  flags, never assumptions (D7).
- **Conformance suite** — `packages/payment-provider-contract-tests`; every adapter must
  pass it before sitting behind the orchestrator.

## External / industry

- **FBO account** — "for benefit of" pooled account at a partner bank holding user funds.
- **Merchant of record (MOR)** — the entity named on the cardholder's statement for a charge;
  for contributions, VinkIn/the program — with the descriptor and dispute duties that follow.
- **BIN sponsor** — the bank whose card-network membership the issuing program operates under.
- **JIT funding / auth stream (ASA)** — issuer patterns where each card authorization is
  approved/declined and funded in real time by the platform.
- **Interchange** — network fee paid by the merchant's acquirer to the card issuer, partially
  shared with issuing platforms.
- **3DS / SCA** — cardholder authentication protocols on the collection side.
- **Reg E / EFTA** — US electronic funds transfer consumer-protection regime (counsel
  questionnaire §2).
- **Escheatment** — state obligation to remit unclaimed funds (counsel questionnaire §5).
