# ENG4 Slice 9 — Crash reporting

**Status:** complete and verified.

Sentry is conditionally integrated in the Flutter app, Node API, Guest Web, and Operations
Console. All four continue to build and run with no DSN, so local development and deployment
are not coupled to the vendor. Tracing sampling is disabled here because ENG4 already has
OpenTelemetry; personally identifiable information is not sent by default.

The API captures unhandled request failures and flushes during shutdown. Both Next.js apps
include server, edge, browser, and global-error instrumentation. Source-map upload activates
only when its Sentry token, organization, and project variables are all present. Flutter wraps
startup with Sentry only when `SENTRY_DSN` is supplied at compile time.

Four independent Sentry projects are configured. Controlled events were received from the
Railway API container, Guest Web browser, Operations Console browser, and Flutter app running
in the iOS simulator on 2026-07-26.

The simulator build exposed an incompatibility between the original `sentry_flutter 8.14.2`
and the resolved Sentry Cocoa package. The Flutter SDK was upgraded to stable `9.25.0`; the app
then compiled, launched, and delivered its verification event. An opt-in
`SENTRY_SMOKE_TEST=true` compile definition sends the controlled Flutter verification event
and is disabled in every normal build.
