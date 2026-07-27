# Decision Note — Stripe "v2 Financial Account" Requirement on Issuing Card Creation

**Date:** 2026-07-27
**Status:** Unresolved provider-account constraint, not a VinkIn architecture decision. Filed
separately from `ENG6-SLICE-5-RECONCILIATION.md` per explicit owner instruction: ENG6 Slice 5
proceeded without touching Financial Accounts, and this note exists to give the owner
everything gathered so far to raise with Stripe or resolve via the Dashboard, not to propose a
VinkIn-side design.

## 1. The exact Stripe request and response

Two separate, real requests against the live sandbox account (`sk_test_...` key, never a live
key) surfaced this. Both are reproduced verbatim below (ids replaced with placeholders; no
secret values appear in either).

**Request 1 — creating a virtual Issuing card**, after cardholder creation succeeded and the
account's `card_issuing` capability requirements were confirmed clear
(`GET /v1/account/capabilities/card_issuing` returned `currently_due: []`):

```
POST /v1/issuing/cards
  cardholder=ich_xxxxxxxxxxxxxxxxxxxxxxxx
  currency=usd
  type=virtual
```

Response:

```json
{
  "error": {
    "code": "parameter_missing",
    "doc_url": "https://stripe.com/docs/error-codes/parameter-missing",
    "message": "The v2 financial account id must be specified.",
    "param": "financial_account_v2",
    "type": "invalid_request_error"
  }
}
```

**Request 2 — probing what a "v2 financial account" actually is**, to understand the shape of
the missing dependency:

```
GET /v2/financial_addresses
```

Response:

```json
{
  "error": {
    "message": "You did not provide an API version. You need to provide an API version header. Learn more at https://stripe.com/docs/api-v2-overview#sdk-and-api-versioning. For the list of valid versions, see https://docs.stripe.com/changelog"
  }
}
```

The second response is the reason this is flagged as a *bigger* wall than the earlier
ToS/requirements gate: `/v2/...` is a structurally different API surface (its own
version-header scheme, separate from the `/v1/...` surface every other VinkIn provider call
uses) — this is not a missing setting on the existing Issuing flow, it is a different Stripe
product surface the card-creation call now requires a reference into.

## 2. Platform account, connected account, or card-program configuration?

**Cannot be concluded from what was queried.** `GET /v1/account` (run earlier in Slice 3) shows
this account is `"type": "standard"` with no `on_behalf_of`/connected-account context in any
call made — nothing here used Stripe Connect, and no request in this investigation touched a
connected-account-scoped endpoint. That rules out "this is a connected-account-only
requirement" as the explanation, but does **not** positively confirm the opposite either — it's
possible Stripe's v2-Financial-Account requirement for Issuing card creation is now a
platform-wide default for standard accounts opened after a certain date, or it's specific to
some other account attribute (business type, country, requested capability set) never
inspected here. No request was made that would distinguish these possibilities.

## 3. Does an ordinary sandbox Issuing balance remain available through the Dashboard?

**Not established either way from the API alone.** Every probe in this investigation used the
API directly (`curl` against `api.stripe.com`); nothing here logged into the Stripe Dashboard
UI itself. It's possible the Dashboard's own "Issuing → Balance" or card-creation flow offers a
different (v1-only) path that the API's `POST /v1/issuing/cards` no longer does directly — or
it's possible the Dashboard enforces the identical v2 Financial Account requirement underneath.
This can only be answered by actually opening the Stripe Dashboard for this account and
attempting to view/fund an Issuing balance or create a test card through the UI, which this
investigation did not do (API-only, per how every other ENG6 diagnostic this session was run).

## 4. Is this caused by selecting the corporate-expense card program?

**Cannot be concluded — no card program was ever explicitly selected.** Nothing in this
account's setup (traced back through Slice 3's own history) ever chose a card program; the
integration used the plain `POST /v1/issuing/cards` call with only `cardholder`, `currency`,
`type: virtual` — no `financial_account`, no program parameter, no expense-card-specific field
of any kind. If Stripe defaulted this account into a specific card program (corporate expense
or otherwise) at onboarding, that happened server-side / at Dashboard-onboarding time, not
through any request this integration made. Confirming or ruling this out requires checking the
account's own Issuing program configuration in the Dashboard (or asking Stripe support
directly) — not visible from any response captured here.

## 5. APIs, preview versions, and account objects involved

What was directly observed, verbatim:

- `POST /v1/issuing/cardholders` — succeeds normally (v1, no financial-account dependency).
- `POST /v1/issuing/cards` — now requires `financial_account_v2` (error above); this is the
  **only** call in this investigation that surfaced the requirement.
- `GET /v1/account/capabilities/card_issuing` — a normal v1 capability object; showed
  `status: "unrequested"`, `requested: false`, with `currently_due` moving from a populated
  list (annual revenue, worker count, ToS acceptance) to `[]` once the owner completed those
  fields.
- `POST /v1/account -d capabilities[card_issuing][requested]=true` — rejected with `"Only live
  keys can access this method"` (a real, confirmed constraint: capability-request mutations on
  the account object are not permitted with a test-mode key, regardless of sandbox/live
  distinction elsewhere in the API). **No live key was used** — this was confirmed to fail and
  then not attempted again, per D46's unconditional live-key prohibition.
- `GET /v2/financial_addresses` — confirmed to exist as a real endpoint requiring its own
  version-header scheme (`Stripe-Version` on `/v2/...` calls, distinct from the account's
  default API version used for `/v1/...` calls) — not explored further than confirming its
  existence and version-header requirement, since going further would mean building against
  a product surface this note exists specifically to flag before building anything.
- Account object: `acct_1RuL41H2VrKtGRMI`, `"type": "standard"`, `country: "US"`.

No `/v2/core/accounts` or `/v2/financial_accounts`-specific object was ever fetched or created
— only the one existence/version-header probe above.

## 6. Minimum architecture change Financial Accounts would require

Based only on the `parameter_missing` error's own shape (`financial_account_v2` is a required
parameter on card creation) — the minimum change, if this path were pursued, would be:

1. Create (or identify an existing) `/v2` Financial Account object for this Stripe account —
   a new Stripe primitive `packages/providers`' current `StripeFinancialProvider` has no code
   for at all.
2. Pass that Financial Account's id as `financial_account_v2` on every `issuing/cards` (and
   likely `issuing/cardholders`, unconfirmed) call — a required-parameter change to
   `issueTemporaryCard`'s Stripe-side implementation.
3. Understand and account for the Financial Account's own balance model — Stripe's v2
   Financial Accounts are explicitly a money-movement/balance primitive (per Stripe's own
   naming and the `/v2/financial_addresses` surface adjacent to it), which is a materially
   different integration shape than "create a card against a cardholder" — this is the part
   that reads as adjacent to "bank-account infrastructure," not merely a new required field.

This is a **lower bound**, not a full scope estimate — whether a Financial Account needs its
own funding/balance step before a card can draw against it, what its own onboarding
requirements are, and whether VinkIn's ledger model would need any adjustment to reason about
a second balance-bearing object are all genuinely unknown without further investigation this
note deliberately did not pursue.

## 7. What cannot be concluded without Stripe confirmation

Stated plainly, not implied:

- Whether this requirement is permanent Stripe policy for all new Issuing integrations, or
  specific to this account's current configuration/program/onboarding path (§2, §4).
- Whether the Stripe Dashboard offers any card-creation or balance-viewing path that avoids
  this v2 requirement (§3).
- Whether requesting the `card_issuing` capability (blocked here on "live keys only") would,
  once done by the owner via the Dashboard, also resolve the `financial_account_v2`
  requirement as a side effect, or whether the two are genuinely independent blockers.
- The full scope of what a Financial Account integration would actually require beyond the one
  required parameter observed (§6) — funding mechanics, its own onboarding, any interaction
  with VinkIn's existing ledger design.
- Whether Stripe support would confirm this is intentional current behavior or something
  particular to this account that a support ticket could adjust.

**No code changes were made in pursuit of this finding.** The 4 issuing-side contract-suite
tests remain disclosed skips exactly as reported in `ENG6-SLICE-3-STRIPE-SANDBOX-ADAPTER.md`;
`StripeFinancialProvider.issueTemporaryCard` is unchanged. This note is investigative record
only, for the owner to take to Stripe or the Dashboard directly.
