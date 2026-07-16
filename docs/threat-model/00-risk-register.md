# 00 — Risk Register

Living document; re-scored at every milestone report. Impact/Likelihood: H/M/L.
"Owner" = who must act (PO = product owner, ENG = engineering, LEGAL = counsel).

## Existential / program risks

| ID | Risk | L | I | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R1 | Provider/BIN sponsor refuses the consumer-spend-of-pooled-funds card program; product as specified cannot launch on stack A | M | H | M0 asks in writing before building; stack B/C fallbacks scoped; purchase-destination seam (§42) keeps a card-free merchant-API future open | PO+ENG | open — M0 |
| R2 | Money-transmission exposure (state MTLs); or partner bank exits the program later (Braid precedent) | M | H | counsel memo in M0; choose providers whose program explicitly covers the flow; provider abstraction (§43) keeps migration possible; document funds flow for any future partner diligence | LEGAL+PO | open — M0 |
| R3 | Liquidity gap: participant captures not available to fund issuing spend at register speed | M | H | S1 measures it; if gapped, platform float + reserve policy (§36) before beta; reserve monitoring alert (§37) | ENG+PO | open — M0 S1 |
| R4 | Off-session charging for restaurant adjustments/recovery not permitted or high-decline | M | M | S10 tests mandates; fallback: organizer-only adjustments; recovery retry policy + restrictions (§23) | ENG | open — M0 S10 |

## Financial-correctness risks (engineering-controlled)

| ID | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| R5 | Double-funding decision (expiry worker vs. late webhook race) | M | H | single-resolver rule + row lock (doc 03 §1); §38 concurrency test is a merge gate | ENG |
| R6 | Dual merchant authorizations double-spend a Vink | M | H | §17 procedure: row lock + unique provider auth id + cumulative limit; race test in CI | ENG |
| R7 | Ledger drift from business state | M | H | same-transaction postings (§27); DB-enforced balance + append-only triggers (doc 04 §5); daily reconciliation + imbalance alert (§37) | ENG |
| R8 | Duplicate charges from client retries / duplicate webhooks | M | H | §12 server-derived operation ids + DB uniqueness; webhook inbox with `UNIQUE(provider, provider_event_id)` | ENG |
| R9 | Participant charged beyond approved maximum (§4.7) | L | H | slot `maximum_amount_minor` checked at capture command + DB CHECK + ledger invariant test | ENG |
| R10 | Late provider events after Vink decision corrupt state | M | M | post-decision events route to cleanup paths only (late capture → refund), never re-decision (doc 03 §1) | ENG |

## Fraud / abuse risks

| ID | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| R11 | **Card testing on the guest checkout endpoint** (unauthenticated, takes cards — a magnet) | H | M | provider fraud tooling (Radar or equiv.), per-token+IP+device velocity limits, CAPTCHA escalation, small-amount alarms, §36 velocity limits | ENG |
| R12 | Organizer self-dealing ring (fake participants funding own card, cash-out via colluding "merchant") | M | H | §36: US-only, low limits, one active Vink per new organizer, KYC, MCC blocks (no gift cards/cash-like), merchant lock, velocity + device signals | ENG |
| R13 | Stolen-card contributions → captured funds spent → chargebacks land on VinkIn | M | H | wallet-preferred UX (device-bound), risk-based 3DS on card fallback, reserve sizing, dispute-rate dashboards (§37) | ENG |
| R14 | Guest-link leakage (QR photographed / token shared) lets a stranger pay-in or see Vink details | M | L | short-TTL single-slot tokens (G4), minimal guest-visible data (§10.4), re-verification above threshold | ENG |
| R15 | Recovery default: organizer owes adjustment, recovery method fails | M | M | §23 retry policy, restrictions, exposure caps (§36), platform reserve; obligation aging dashboard | ENG+PO |

## Delivery / operational risks

| ID | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| R16 | Solo-builder bus factor & review gap on financial code | H | M | CI gates (§9.13), §38 suites as merge gates, milestone security review checklists, keep modules small | PO |
| R17 | Register-speed UX misses (30–60s target §2) — product dies on slowness, not correctness | M | H | §34 performance budgets measured in M4 exit; wallet-first design; latency dashboards (§37) | ENG |
| R18 | Apple Pay on guest web fails in in-app browsers (Instagram/TikTok webviews) | H | M | §34 escape path ("Open in Safari"), detect webview, card fallback; measure wallet fallback rate (§37) | ENG |
| R19 | App Store review friction for a payments app (guideline scrutiny, financial disclosures) | M | M | native flows use provider SDKs; card display via provider component; prepare reviewer notes; beta via TestFlight | PO+ENG |
| R20 | Repo location: `~/Downloads`, path contains a space, no git yet; parent-dir CLAUDE.md from another project leaks context | H | L | owner: `git init` + move to `~/code/vinkin`; repo-local CLAUDE.md (done) | PO |

## Standing review triggers

Re-open this register when: a provider answer arrives (R1–R4), any §38 concurrency test is
skipped/flaky (R5–R8), guest checkout goes to any public URL (R11, R14), or limits in §36
are raised.
