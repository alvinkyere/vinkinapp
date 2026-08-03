# VinkIn — Sandbox Test Plan (S1–S12)

_Canonical home of the S-tests (moved from `docs/provider-integration/00-provider-feasibility.md`).
Each test runs per candidate provider once sandbox credentials exist; scripts live in
`packages/payment-provider/spike/` and drive the provider through the neutral
`FinancialProvider` interface, so the same scripts run against every adapter — including
`MockFinancialProvider`, which is how the scripts are developed before credentials arrive.
Results fill the table below and are gate condition 7 evidence._

## Baseline

Before S-tests, the candidate's adapter must pass the shared conformance suite
(`packages/payment-provider-contract-tests`) with all skips justified in writing.

## Tests

| # | Spec §39 item | Test | Pass criteria |
|---|---|---|---|
| S1 | funds flow | capture test charge → measure when funds are usable → transfer to issuing balance → measure | end-to-end timing documented; if not register-speed, float requirement quantified in `funds-flow.md` |
| S2 | consumer issuing / cardholder structure | create a cardholder for a test consumer identity | required fields, agreements, and KYC steps documented; consumer structure confirmed or rejected in writing |
| S3 | virtual card creation | issue amount-capped virtual card | issue latency ≤ 5s p95; controls verified active at first auth |
| S4 | real-time authorization | simulate merchant auth; approve and decline from our webhook | our decision sticks; decision deadline + timeout default documented |
| S5 | merchant controls | exercise MCC allow/block; inspect auth payload | payload carries stable merchant id + MCC + country (terminal id noted); lock keys chosen |
| S6 | wallet contributions | Apple Pay + Google Pay test charges on a domain-verified test page | both wallets complete on mobile web without an account |
| S7 | manual capture | authorize → partial capture → cancel remainder | partial capture works; auth-hold TTL documented |
| S8 | refunds | refund captured charge | webhook sequence + timing documented (drives §25 user messaging) |
| S9 | disputes | trigger sandbox dispute | event mapping to `DISPUTED` slot state verified |
| S10 | recovery charging | off-session charge on saved method | permitted; mandate/consent requirements documented |
| S11 | multicapture / extended auth | attempt on both acquiring and issuing sides | capability matrix recorded in the adapter's `ProviderCapabilities` |
| S12 | webhook behavior | duplicate, out-of-order, replay, bad signature | event ids stable across redelivery; signature scheme documented; inbox dedup verified |

## Results

| Test | Stripe stack | Lithic stack | Notes |
|---|---|---|---|
| S1–S12 | _pending credentials_ | _pending credentials_ | |

## Reporting

Each run appends: date, API version, script commit, raw latency numbers, and anomalies. A
test that cannot be executed in sandbox is recorded as **UNVERIFIABLE-IN-SANDBOX** with the
provider's written statement of production behavior (questionnaire item 21) — never assumed.
