# PV0 — Build Governance

How the [master plan](master-plan.md) applies to this repository. The master plan §2 lists
green/red work in product terms; this document makes the boundary mechanical: which
directories may contain what, which flags gate simulated behavior, and what CI enforces.

## 1. Relationship to the Milestone 0 gate

The PV track runs **while the M0 gate is open** and must stay inside the gate's "permitted"
column (`docs/architecture/06-milestone-0-gate.md`): everything is provider-neutral and
mock-backed, so nothing built here changes shape if gate conditions 1–2 come back "no". Three
clarifications (recorded as decision-log entry D10):

- **Mock card lifecycle and mock settlement are permitted.** The gate forbids work "whose
  shape depends on unconfirmed funds flow"; the PV card/settlement flows are driven through
  the neutral `FinancialProvider` interface against `MockFinancialProvider` only, and are
  explicitly disposable if a provider answer invalidates them. The gate's "card-display UI"
  prohibition still stands for anything resembling real PAN display — mock cards render a
  clearly-labeled simulation with `display_last_four` only, never PAN/CVV.
- **Ledger DDL for the validation build is not "production ledger migrations".** PV-track
  migrations live under the validation build and carry mock money. Production ledger DDL
  remains gated on M0 (D2 timing unchanged for the production track).
- **The M0 gate still governs provider integration.** No adapter beyond the mock exists until
  the gate's ten conditions are met (master plan §28).

## 2. Work classification (repo-mechanical form)

**Green** — may land any time on the PV track:

- Everything in master plan §2 "Green-light work".
- New packages under `packages/` that import only Node built-ins, other `@vinkin/*`
  packages, or the approved dev toolchain.
- Docs, ADRs, threat-model updates, CI, tooling scripts.

**Yellow** — permitted only behind a feature flag, default off (see §4):

- `RESTAURANT_VARIABLE` policy simulation (master plan §16).
- Simulator endpoints (`/internal/simulator/*`) — environment-guarded, never production.
- Mock-provider chaos scenarios exposed through the operations console.

**Red** — must not enter the repository while the M0 gate is open:

- Everything in master plan §2 "Red-light work".
- Any import of a provider SDK outside an approved adapter directory (§3 below).
- Any schema, type, or table named for a specific provider's object model
  (e.g. `payment_intents`, `treasury_*`, `connect_*`).
- Any copy, UI string, or doc that claims VinkIn moves or holds real consumer money.

## 3. Provider-import CI guard

`tooling/scripts/check-provider-imports.mjs` (zero-dependency Node script) scans every
tracked source file for imports/requires of prohibited provider packages:

```text
stripe, @stripe/*, lithic, @lithic/*, marqeta, @marqeta/*,
galileo, unit, @unit-finance/*, treasuryprime, @treasuryprime/*,
plaid (real-money linking), braintree, @adyen/*, square, @square/*
```

**Approved adapter directories** (the only places a provider SDK import may ever appear,
and only after the M0 gate permits that adapter):

```text
packages/payment-provider/src/adapters/<provider>/
packages/providers/<provider>/            (future layout, master plan §28)
```

The guard also fails if any `package.json` in the repo declares a prohibited package as a
dependency. It runs as a CI job on every push/PR (`.github/workflows/ci.yml`) and can be run
locally: `node tooling/scripts/check-provider-imports.mjs`.

The guard is a tripwire, not the boundary itself — code review still enforces §2. But no
prohibited SDK can land *accidentally*.

## 4. Feature flags

No runtime flag service exists yet (that is PV1+). Flags are declared here first so every
later milestone implements the same set. All default **off**.

| Flag | Gates | Default | May be enabled in |
|---|---|---|---|
| `simulator_endpoints` | `/internal/simulator/*` routes | off | development, test, demo |
| `restaurant_variable_policy` | `RESTAURANT_VARIABLE` policy simulation | off | development, test |
| `mock_chaos_scenarios` | operations-console scenario controls | off | development, test, demo |
| `guest_signup_conversion` | optional account creation after guest flow (PV10) | off | any |

Rule: a flag may never be flipped on in an environment its row does not list. Production
enablement of any simulator/chaos flag is forbidden outright (master plan §13).

## 5. Environment definitions

| Environment | Purpose | Simulator endpoints | Data |
|---|---|---|---|
| `development` | local docker-compose stack | allowed | throwaway |
| `test` | CI integration/E2E runs | allowed | ephemeral |
| `demo` | observed validation sessions (PV12) | allowed, operator-only | reset between sessions |
| `staging` | pre-production parity (post-PV) | **blocked** | synthetic |
| `production` | real users (post-M0-gate only) | **blocked by hard guard** | real |

Every service reads `VINKIN_ENV` and must refuse to register simulator routes unless the
value is `development`, `test`, or `demo` — an allowlist, not a `!== 'production'` check.

## 6. Definition of done (PV track)

The overall validation build is done per master plan §27. Per-milestone, "done" means:

1. Exit gate of the PV milestone demonstrably met (test or command shown in the report).
2. All package tests green (`npm test` per package), strict typecheck clean.
3. Provider-import guard green.
4. New interpretations recorded in `docs/spec/decision-log.md`; product-visible changes
   flagged to the owner, never silent (Spec §9).
5. Milestone report in `docs/architecture/milestone-reports/` in the §45 format.

## 7. PV0 exit gate status

> "No provider-specific production work can enter the repository accidentally."

Met when the CI guard job is green on `main` and this document plus D10/D11 are committed.
