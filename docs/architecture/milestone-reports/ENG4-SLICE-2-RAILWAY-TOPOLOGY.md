# ENG4 Slice 2 — Railway deployment topology

**Date:** 2026-07-25  
**Status:** code-complete; external provisioning pending

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

## External actions remaining

1. Push the deployment configuration to GitHub.
2. Create the Railway project and five services.
3. Set each source service's Config File Path.
4. Add variables and generate temporary public domains.
5. Deploy and smoke-test.
6. Attach the three `vinkin.org` custom domains.
7. Configure spending controls and database backups.

No Railway resource, DNS record, or secret was created from the local repository.
