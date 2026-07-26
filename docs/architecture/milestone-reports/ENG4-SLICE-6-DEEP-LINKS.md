# ENG4 Slice 6 — Universal Links and App Links

**Status:** iOS complete in code; Android association awaits the Play signing certificate.

The mobile router now accepts both `vinkin://vinks/<id>` and
`https://join.vinkin.org/app/vinks/<id>`. The Guest Web supplies a browser fallback for the
HTTPS route and publishes Apple's association file for Team ID `APBXUQAJAU` and bundle ID
`com.vinkin.vinkinMobile`. The iOS target has the `applinks:join.vinkin.org` entitlement.

An Android target was generated and frozen at application ID `com.vinkin.vinkinmobile`. Its
manifest includes verified HTTPS and custom-scheme intent filters. The repository deliberately
does not publish `assetlinks.json` yet: its SHA-256 certificate fingerprint must come from
Google Play App Signing, and inventing or using a debug fingerprint would break production
verification.

Deep-link/config Flutter tests pass. The Guest Web production build includes the fallback
route. Full device verification remains a release-certification task after the updated Guest
Web is deployed and the Play signing fingerprint is available.
