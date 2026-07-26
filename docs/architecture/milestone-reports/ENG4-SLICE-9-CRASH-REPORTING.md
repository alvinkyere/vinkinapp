# ENG4 Slice 9 — Crash reporting

**Status:** Sentry integration complete in code; projects, DSNs, and test events are pending.

Sentry is conditionally integrated in the Flutter app, Node API, Guest Web, and Operations
Console. All four continue to build and run with no DSN, so local development and deployment
are not coupled to the vendor. Tracing sampling is disabled here because ENG4 already has
OpenTelemetry; personally identifiable information is not sent by default.

The API captures unhandled request failures and flushes during shutdown. Both Next.js apps
include server, edge, browser, and global-error instrumentation. Source-map upload activates
only when its Sentry token, organization, and project variables are all present. Flutter wraps
startup with Sentry only when `SENTRY_DSN` is supplied at compile time.

Certification requires four Sentry projects/DSNs, deployed environment variables, and one
verified test event from each runtime.
