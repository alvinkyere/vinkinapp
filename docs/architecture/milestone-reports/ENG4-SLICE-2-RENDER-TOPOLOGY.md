# ENG4 Slice 2 — Render deployment topology

**Date:** 2026-07-25  
**Decision:** Render is the final hosted-pilot platform, superseding the previously discussed
Railway alternative.

## Built

- Repository-root `render.yaml` defining a single `vinkin` project with protected,
  private-network-isolated staging and production environments.
- Per environment: API web service, background worker, Guest Web service, Operations Console
  service, PostgreSQL 16, durable Render Key Value, and an environment group.
- Staging uses `autoDeployTrigger: checksPass` from `main`; production uses
  `autoDeployTrigger: off`.
- Six locked custom domains under `vinkin.org`.
- Private-only PostgreSQL and Key Value ingress. Key Value uses `noeviction`, Render's
  recommended queue policy, with journal/snapshot persistence.
- API readiness wired to the existing dependency-aware `/health/ready`.
- Controlled migrations: only the API pre-deploy command runs the existing advisory-locked
  migration runner.
- New read-only `check-schema.ts` startup gate used by API and worker. It refuses both missing
  migrations and a database migrated beyond the running commit.
- Architecture/runbook documentation covering provisioning, DNS, secrets, deployment order,
  rollback, and the explicit Render cross-service-ordering limitation.

## Deliberate boundaries

- No Render resources were provisioned: workspace/GitHub access and cost approval are required
  before creating billable external infrastructure.
- No DNS record was guessed: Render must first assign the service hostnames and verification
  targets.
- No Sentry configuration was added; that remains Slice 9.
- No production deploy workflow was added; Slice 8 will orchestrate migration → API → worker →
  web → smoke tests after the Blueprint supplies stable Render service IDs.
- Universal/App Links remain Slice 6 and still require the Apple Developer Team ID.

## Exit state

The deployment topology is decided and represented as code. The remaining external action is to
connect the repository in Render, review the generated resource/cost plan, and apply the
Blueprint. Production remains incapable of automatic deployment by construction.
