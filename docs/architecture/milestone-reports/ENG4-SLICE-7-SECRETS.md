# ENG4 Slice 7 — Secrets management

**Status:** application and repository controls complete; Railway holds runtime secrets.

The hosted pilot uses Railway encrypted variables and private service references. PostgreSQL
and Redis are not public. Production and any future staging environment must have separate
databases, Redis instances, JWT keys, operator credentials, and provider credentials.

`tooling/scripts/check-secrets.mjs` and CI now reject tracked dotenv files, signing keys,
mobile provider configuration, and other common credential artifacts. Runtime schemas retain
fail-fast minimum-strength checks. No production secret value is stored in this repository.

The owner reports that deployed keys have been rotated/updated. A provider-side secret audit
and a restore rehearsal remain operational certification items.
