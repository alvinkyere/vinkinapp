# Railway hosting architecture

**Decision:** Railway is the hosting platform for the closed pilot. This supersedes the
unprovisioned Render plan.

## Initial production topology

The first hosted pilot uses one Railway project and one production environment:

| Railway service | Source | Public |
| --- | --- | --- |
| `api` | GitHub monorepo, `apps/api/railway.json` | Yes |
| `guest-web` | GitHub monorepo, `apps/guest-web/railway.json` | Yes |
| `operations-console` | GitHub monorepo, `apps/operations-console/railway.json` | Yes |
| `Postgres` | Railway managed PostgreSQL | No |
| `Redis` | Railway managed Redis | No |

There is no separate worker service for the initial pilot. The API process already starts the
deadline sweep scheduler and outbox publisher. Adding `pnpm --filter @vinkin/api worker` now
would add cost while duplicating only the current worker heartbeat; a standalone worker becomes
appropriate when real queue consumers move out of the API process.

All three source services use the repository root as their build context because this is a
shared pnpm workspace. Do not configure a Railway Root Directory. Instead, set each service's
absolute Config File Path:

- API: `/apps/api/railway.json`
- Guest Web: `/apps/guest-web/railway.json`
- Operations Console: `/apps/operations-console/railway.json`

## Deployment and migrations

The API configuration performs one controlled pre-deploy migration:

1. Railpack builds the commit from the monorepo root.
2. `pnpm --filter @vinkin/api migrate` runs in Railway's private network.
3. A failed migration prevents the deployment.
4. API startup runs the read-only schema compatibility check.
5. Railway checks `/health/ready` before switching traffic.

Neither web service runs migrations. Both validate their environment before `next start`.

## Variables

Set these on `api`:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
VINKIN_ENV=demo
JWT_SECRET=<random value of at least 32 characters>
OPERATOR_PASSWORD=<strong pilot operator password>
LOG_LEVEL=info
VINKIN_OTEL_ENABLED=0
VINKIN_METRICS_ENABLED=0
VINKIN_CONTRIBUTION_PROJECTION_ENABLED=1
VINKIN_PARTICIPANT_INCLUSIVE_RETRIEVAL=1
VINKIN_INVITES_ENABLED=1
VINKIN_AUTOMATIC_INVITATION_DELIVERY_ENABLED=0
VINKIN_PUBLIC_BASE_URL=https://<guest-web Railway domain>
OPERATIONS_CONSOLE_BASE_URL=https://<operations-console Railway domain>
VINK_OPEN_DURATION_SECONDS=86400
VINK_PROCESSING_GRACE_SECONDS=60
VINK_SWEEP_INTERVAL_SECONDS=10
GUEST_RESEND_COOLDOWN_SECONDS=60
```

Set these on `guest-web`:

```text
VINKIN_ENV=demo
NEXT_PUBLIC_API_BASE_URL=https://<api Railway domain>
NEXT_PUBLIC_GUEST_CONTRIBUTION_STATUS_UI=1
```

Set these on `operations-console`:

```text
VINKIN_ENV=demo
NEXT_PUBLIC_API_BASE_URL=https://<api Railway domain>
```

`NEXT_PUBLIC_API_BASE_URL` is compiled into each Next.js browser bundle, so changing it requires
a redeploy, not only a process restart.

## Domains

Use Railway-generated domains for the first smoke test. After all three services are healthy,
attach:

- `api.vinkin.org` to `api`
- `join.vinkin.org` to `guest-web`
- `ops.vinkin.org` to `operations-console`

Then replace the temporary Railway domains in the variables above with the custom HTTPS domains
and redeploy all three services. Keep PostgreSQL and Redis private.

## Environments and cost control

The initial pilot deliberately provisions production only. A fully duplicated staging
environment would double database and Redis usage before the product is proven. Add a Railway
staging environment later, with a separate PostgreSQL service, Redis service, JWT secret,
operator password, and provider credentials; never share production data or secrets.

Use the Hobby plan and configure a low usage alert/hard limit in Railway. Production deploys
remain deliberate releases; do not enable automatic production deployment until the staging
environment and release approval workflow exist.

Railway's environment is named Production, but the application runtime is deliberately
`VINKIN_ENV=demo` for this closed pilot. The only implemented financial adapter is the mock
provider, and simulator-backed contribution/purchase routes are correctly refused by the API in
`staging` and `production`. Change the runtime to `production` only after a real payment
provider passes the provider contract and replaces the mock adapter.

## Rollback

- Application rollback: redeploy the previously healthy GitHub commit.
- Database migrations are forward-only and must remain compatible with the previous app for one
  release window.
- The startup schema check refuses incompatible application/database combinations.
- Add and rehearse database backups before allowing pilot financial traffic.
