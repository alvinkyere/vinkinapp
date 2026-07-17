# docs/spec — the authoritative specification

Contents:

- **`master-roadmap-prompt.md`** — the VinkIn Master Engineering Roadmap, verbatim. This is
  "the Spec"; every §N reference in this repo points here. It is read-only: changing it is a
  product decision by the owner, recorded with a dated changelog entry at the top of that file.
- **`decision-log.md`** — every interpretation, G-resolution, and architectural choice, with
  status (PROPOSED/ACCEPTED/…), reason, alternatives, affected modules, revisit trigger.
- **`open-questions.md`** — unresolved questions (G1–G12) with owners; rows move to Resolved
  only when the decision log gains the entry.
- **`glossary.md`** — project and industry terms as used in this repo.

Rules: derived docs cite the Spec by section (§N) and flag — never silently absorb — any
deviation (Spec §9). The Spec outranks derived docs; derived docs outrank code comments.
