# Provider contracts

Load only the provider sections relevant to the requested game setup. Provider
APIs and dashboard fields change; verify current official documentation before
relying on an endpoint or scope.

## Shared rules

- Use the production bundle/package authority from the native recipe.
- Match records by provider parent account, platform, and exact bundle/package
  ID. Use title only as an additional check.
- Keep administration credentials separate from runtime client credentials.
- Store runtime credentials only after exact post-create or reuse readback.
- Record provider IDs and redacted fingerprints; never persist raw credentials
  in manifests or receipts.

## GameAnalytics

- Keep separate games for iOS and Android.
- Verify organization, studio, game ID, title, platform, bundle/package ID, SDK,
  and store platform.
- Runtime credentials are the 32-character game key and 40-character secret.
- The Organization API administration key is distinct from runtime game
  credentials. A game key and secret cannot administer the organization.
- If authenticated dashboard fallback is required, capture only the dashboard's
  existing authorization context, perform exact API readback, and transfer
  credentials through a protected file rather than terminal output.

## Firebase

- Reuse the intended Firebase project unless isolation requirements say
  otherwise; create a platform app under it for the exact bundle/package ID.
- Verify project ID, app ID, bundle/package ID, and display name.
- Treat `GoogleService-Info.plist` or `google-services.json` as an owner-only
  native resource. Validate its identity before projecting runtime fields.
- Common web/runtime fields include API key, project ID, app ID, and messaging
  sender ID. Read the game's actual runtime and validator before assuming which
  optional fields are required.

## RevenueCat

- Match project and app by exact platform and bundle/package ID.
- Distinguish the public SDK key from the administrative API key.
- Read access to apps does not prove catalog mutation authority.
- Verify products, entitlement, offering, and packages separately from adopting
  an existing public SDK key. Report unsupported catalog mutation honestly.

## Adjust

- Match app name, platform, store ID/bundle identity, and Adjust app token using
  documented readback fields.
- Treat app creation as asynchronous when the API returns a ticket; poll the
  documented status endpoint before claiming success.
- Keep the app token and optional event tokens in protected runtime references.
- If attribution is disabled by approved game policy, materialize the explicit
  disabled intent instead of inventing tokens.

## AdMob

Read [admob.md](admob.md) before operating on AdMob.

- Match AdMob account, app, platform, and store/app identity before creating ad
  units. Store linking is irreversible.
- Reconcile banner, interstitial, and rewarded placements by exact format and
  stable canonical name. Create missing canonical units under one approved
  convergence operation; never delete or disable extras automatically.
- Keep the app ID distinct from ad-unit IDs. Both are public runtime identifiers
  and belong in committed reproducible configuration.
- Keep OAuth client secrets, refresh tokens, access tokens, payment data, and
  test-device IDs outside Git and command output.
- Device verification must use registered test traffic or provider-supported
  test mode. Never click production ads or use production impressions as test
  evidence.
