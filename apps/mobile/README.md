# VinkIn mobile

## Local development

The default build connects to the API and Guest Web processes on the host machine:

```bash
flutter run
```

Default URLs:

```text
http://127.0.0.1:3000
http://127.0.0.1:3100
```

## Hosted closed-pilot build

`config/pilot.json` is the checked-in, non-secret source of truth for the hosted endpoints and
pilot UI flags:

```text
https://api.vinkin.org
https://join.vinkin.org
```

Run a hosted debug build:

```bash
flutter run --dart-define-from-file=config/pilot.json
```

Build iOS for TestFlight:

```bash
flutter build ipa --release --dart-define-from-file=config/pilot.json
```

Build the Android App Bundle for Google Play Internal Testing:

```bash
flutter build appbundle --release --dart-define-from-file=config/pilot.json
```

The file contains no secrets. API credentials and session tokens are obtained at runtime and
stored in platform secure storage; never place Railway, JWT, operator, signing, or provider
secrets in a Dart define.

Before distributing a build, verify the resolved endpoints:

```bash
flutter test test/core/networking/api_config_test.dart \
  --dart-define-from-file=config/pilot.json
```
