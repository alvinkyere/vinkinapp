# ENG4 Slice 2 — Railway deployment topology

**Date:** 2026-07-25  
**Status:** provisioned and hosted smoke-tested

## Decision

The owner selected Railway after rejecting Render's estimated pilot cost. The first deployment
is production-only on Railway Hobby: API, Guest Web, Operations Console, managed PostgreSQL, and
managed Redis. A separate worker and duplicated staging environment are deferred until their
cost has a demonstrated product need.

Railway's environment is named Production while the application uses `VINKIN_ENV=demo`: this is
the closed pilot and the only implemented financial adapter is still the simulator. The API's
allowlist correctly refuses simulator-backed financial routes in a true production runtime.

## Implemented

- Removed the unprovisioned Render Blueprint and Render-specific architecture document.
- Added service-local Railway configuration-as-code for API, Guest Web, and Operations Console.
- Kept every shared-monorepo build rooted at the repository root.
- Configured the API's migration as the sole pre-deploy migration step.
- Configured API readiness and web health checks, bounded restart policies, and deployment
  draining.
- Preserved startup schema compatibility refusal for the API.
- Documented exact service variables, Railway references, domain activation, staging isolation,
  cost control, and rollback.

## Hosted verification

Railway is provisioned at:

- `https://api.vinkin.org`
- `https://join.vinkin.org`
- `https://ops.vinkin.org`

The API readiness endpoint reported PostgreSQL and Redis healthy. A real hosted smoke flow then
registered a clearly labeled test organizer, created a $12 Vink, added a manual guest, applied
an equal split, opened the Vink, authorized both shares through the demo adapter, and reached
`FUNDED`. The generated `join.vinkin.org/g/...` page and Operations Console root both returned
HTTP 200.

Smoke record identifiers:

```text
username: codexsmoke_dfd36b0c
vink_id: 0d899263-bc2b-43e9-8078-57c8d35c3488
```

No real money or provider credential was involved; `VINKIN_ENV=demo` and the mock provider
handled both contribution authorizations.

## Remaining actions

1. Configure and verify Railway spending controls.
2. Configure and rehearse PostgreSQL backup/restore.
3. Add the isolated staging environment before automatic production deployments.
4. Replace the demo adapter and switch to `VINKIN_ENV=production` only after provider contract
   certification.

Secrets remain Railway-managed and are not recorded in the repository.
