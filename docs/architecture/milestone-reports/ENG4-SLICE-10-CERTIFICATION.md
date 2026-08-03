# ENG4 Slice 10 — Hosted pilot certification

**Status:** not complete.

## Verified

- Railway API, Guest Web, Operations Console, PostgreSQL, and Redis are live on the production
  custom domains.
- `/health/ready` reports both PostgreSQL and Redis healthy.
- A hosted create-to-funded smoke test completed successfully.
- API tests, workspace typecheck, both web production builds, and focused mobile tests pass.
- iOS Universal Link files and routing are implemented.
- CI, hosted smoke, mobile release checks, and secret-file guards are implemented.
- Crash reporting is verified with controlled events from API, Guest Web, Operations Console,
  and Flutter; normal builds remain safe when a DSN is absent.

## Release blockers

1. Create the Play app, obtain its App Signing SHA-256 fingerprint, publish
   `/.well-known/assetlinks.json`, and test Android App Links.
2. Protect GitHub's `production` environment with required reviewers and align Railway
   production deployment controls with it.
3. Configure Railway spend alerts/limit and verify database backup/restore.
4. Run signed TestFlight and Google Play Internal Testing builds on real devices.
5. Provision an isolated staging environment before opening the pilot beyond the current
   deliberately production-only demo topology.

Until these external checks are complete, ENG4 must remain in progress.
