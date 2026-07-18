# 07 — System Context (the authoritative architecture diagram)

_Owner-directed 2026-07-17. (Requested as `06-system-context.md`; numbered 07 because 06 is
the Milestone 0 gate, whose references must not break.)_

One diagram. **Every new feature must fit somewhere in it. If a feature doesn't fit, that is
a signal to revisit the architecture before writing code** — not to bend the diagram after
the fact.

```text
Flutter (organizer)      Guest web        Operations console
        │                    │                    │
        └────────────┬───────┴────────────────────┘
                     ▼
              Gateway / API            ← transport only (HTTP/WebSocket); no business logic
                     │
                     ▼
             Application Layer         ← explicit commands (D13): validate → load →
                     │                    transition → emit event → return aggregate
                     ▼
                  Domain               ← packages/domain: state machines (D12: every
                     │                    transition emits its event), split/policy engines,
                     │                    invariants
        ┌────────────┼─────────────┐
        │            │             │
     Ledger       Session     Contribution
        │            │             │
        └────────────┼─────────────┘
                     │
          FinancialProvider interface   ← packages/payment-provider (Spec §43)
                     │
          MockFinancialProvider         → later: one provider adapter, config-enabled
                                          (M0 gate permitting; master plan §28)
```

Rules the diagram encodes:

1. **Downward dependencies only.** A layer may call the layer directly beneath it; nothing
   reaches around a layer (no route handler touching the domain, no domain code touching a
   provider SDK).
2. **Transports are thin** (D13). HTTP, WebSocket, CLI, and jobs invoke application
   commands; they never mutate aggregates.
3. **The domain is pure.** No I/O, no provider types, no persistence — it decides; the
   application layer executes.
4. **One provider seam.** Everything above `FinancialProvider` is provider-agnostic;
   swapping `MockFinancialProvider` for a real adapter touches nothing above the seam (D10,
   ratified).
5. **Events flow from transitions** (D12) into the transactional outbox, feeding realtime,
   notifications, analytics, and replay — consumers never write state back directly; they
   invoke commands.

Placement guide for the current repository:

| Diagram element | Repository location |
|---|---|
| Gateway / API | `apps/api` (PV1) |
| Application layer | `packages/application` (PV3+) |
| Domain | `packages/domain` |
| Ledger | `packages/ledger` (PV5, per D2 timing) |
| FinancialProvider seam | `packages/payment-provider` |
| Mock provider | `packages/payment-provider` (`src/mock/`) |
| Clients | `apps/mobile`, `apps/guest-web`, `apps/operations-console` (PV9–PV11) |
