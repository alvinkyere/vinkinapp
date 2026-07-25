# Render hosting architecture

**Decision:** Render is the hosting platform for the hosted pilot. This supersedes all earlier
Railway/Render alternatives. The repository-root `render.yaml` is the infrastructure source of
truth.

## Environments

Render project `vinkin` contains two protected, network-isolated environments:

| Environment | Deployment | API | Guest Web | Operations |
| --- | --- | --- | --- | --- |
| Staging | Automatic after GitHub checks pass on `main` | `staging-api.vinkin.org` | `staging-join.vinkin.org` | `staging-ops.vinkin.org` |
| Production | Manual only | `api.vinkin.org` | `join.vinkin.org` | `ops.vinkin.org` |

Each environment owns separate API, worker, Guest Web, Operations Console, PostgreSQL, Key
Value, environment group, JWT secret, and operator password. No database, Redis/Valkey
instance, secret, or provider credential is shared across environments.

All resources are in Render's Ohio region. It is the closest current Render region to the
pilot's America/Detroit operating timezone and keeps API/database/queue traffic on one private
network.

## Service topology

- API: Render Web Service; `/health/ready` must pass before a deployment is healthy.
- Worker: Render Background Worker.
- Guest Web: Render Web Service.
- Operations Console: Render Web Service.
- PostgreSQL: Render PostgreSQL 16, with public inbound access blocked.
- Queue/realtime: Render Key Value (Valkey, Redis-protocol compatible), public inbound access
  blocked, `noeviction`, journal + snapshot persistence.

The API, worker, and both Next.js apps build from the monorepo root. Do not set a Render Root
Directory for these services: the API imports workspace packages outside `apps/api`, and pnpm
needs the root workspace and lockfile.

## Deployment and migrations

No runtime process applies migrations on startup.

1. Render builds the API commit.
2. The API's single `preDeployCommand` runs `pnpm --filter @vinkin/api migrate`.
3. The advisory lock in `src/db/migrate.ts` serializes the migration transaction.
4. API startup runs `src/db/check-schema.ts` and refuses an older or newer schema.
5. Worker startup runs the same read-only compatibility check and never migrates.
6. Render checks `/health/ready` before considering the API healthy.

Render does not provide cross-service deploy ordering inside a Blueprint. The worker therefore
fails closed if it is deployed before the API's pre-deploy migration completes. ENG4 Slice 8
will add the release orchestrator that deploys API/migration first, then worker and web
services, then runs smoke tests.

Production has `autoDeployTrigger: off`. A production release must be a deliberate deployment
of a known commit after:

1. CI is green.
2. The same commit is healthy in staging.
3. Migration impact and rollback compatibility are reviewed.
4. An explicit release version is assigned.

## Secrets

Render environment groups hold shared per-environment runtime configuration. Render generates
independent JWT and operator secrets during initial Blueprint creation. Future provider,
delivery, Sentry, and signing credentials must be entered directly in Render; never commit them
or paste them into documentation.

`VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED` remains off because no real delivery provider is
selected. OTel and the standalone Prometheus port also remain off until the hosted observability
destination is configured; Sentry is ENG4 Slice 9.

## DNS activation

After the Blueprint creates the web services:

1. Render displays each service's `onrender.com` hostname and required verification records.
2. Add the supplied DNS records for the six subdomains at the `vinkin.org` DNS provider.
3. Verify each custom domain in Render.
4. Confirm Render-issued TLS and HTTPS redirects.
5. Keep `vinkin.org` itself pointed at the existing marketing site.

Do not invent DNS targets before Render assigns the service hostnames. Render custom domains
retain an `onrender.com` address by default; disabling those fallback hostnames can be considered
after custom-domain smoke tests pass.

## Rollback

- Application rollback: deploy the previously healthy commit from Render's service events.
- Database rollback: migrations are forward-only. A migration must remain compatible with the
  previous application version for at least one release window. Destructive column/table
  removal requires a later cleanup release after old code is gone.
- Worker rollback: deploy the worker from the same commit as the API. The schema check refuses a
  worker that does not match the database migration set.
- Data recovery: use Render PostgreSQL point-in-time recovery for paid instances; rehearse this
  before the pilot certification.

## Provisioning checklist

- [ ] Connect the GitHub repository to a Render Blueprint.
- [ ] Review the estimated cost of 8 compute services, 2 PostgreSQL instances, and 2 Key Value
      instances before applying.
- [ ] Apply `render.yaml`.
- [ ] Confirm staging and production generated secrets differ.
- [ ] Add and verify six DNS subdomains.
- [ ] Run migrations and staging smoke tests.
- [ ] Confirm production services remain manual-deploy only.
- [ ] Record Render service IDs for the ENG4 Slice 8 release workflow.
