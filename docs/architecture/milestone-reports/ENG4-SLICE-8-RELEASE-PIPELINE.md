# ENG4 Slice 8 — Release pipeline

**Status:** repository workflow complete; external approval policy still needs activation.

Pull requests run lint, typecheck, format, guard, secret scanning, web/API validation, and
Flutter analysis/tests. A scheduled/manual hosted smoke workflow checks the API's PostgreSQL
and Redis readiness plus both public web applications and Apple's association file.

The manual mobile release workflow targets a protected GitHub `production` environment and
compiles unsigned Android and iOS release builds. Signing and store upload remain explicit
human release actions.

Before production releases are certified, configure required reviewers on the GitHub
`production` environment and ensure Railway does not bypass that approval through automatic
production deploys. Database migrations remain one controlled API pre-deploy step.
