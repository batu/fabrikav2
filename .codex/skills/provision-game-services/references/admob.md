# Guarded AdMob provisioning

Use this reference for AdMob account discovery, app linking, canonical ad-unit creation, and public runtime configuration. Provider APIs change; verify the current official v1beta reference before changing request shapes. The guarded helper currently permits irreversible linking only for iOS because it can verify App Store identity authoritatively; Android apply fails closed until equivalent Google Play verification is implemented.

## Identity model

Treat these as separate identities:

- Google Cloud OAuth client: administrative authentication, secret.
- AdMob account resource: parent for apps and units, operator-sensitive but not a runtime secret.
- Store identity: iOS numeric App Store ID or Android package ID, public and immutable once linked.
- AdMob app ID: `ca-app-pub-…~…`, public runtime identifier.
- Ad-unit ID: `ca-app-pub-…/…`, public runtime identifier.

An app title is supporting evidence, never a natural key. Match account, platform, and exact store identity.

## Credential bootstrap

Request only:

- `https://www.googleapis.com/auth/admob.readonly` for discovery.
- `https://www.googleapis.com/auth/admob.monetization` for app and unit creation.

Prefer a macOS Keychain generic-password item whose value is JSON containing `client_id`, `client_secret`, and `refresh_token`. The helper also supports an owner-only (`0600`) JSON file and adoption of an existing matching oauth2l cache grant. Never store or print an access token; refresh one inside each invocation.

A Google OAuth desktop client can be created in the intended shared automation project. Complete interactive consent for the exact scopes above, capture the refresh grant through the OAuth tool, then transfer it directly to Keychain or the protected fallback. Do not create a cloud project per game.

Example Keychain write, with the JSON read from a protected file rather than argv:

```bash
security add-generic-password \
  -U \
  -s fabrikav2-admob-oauth \
  -a "$USER" \
  -w "$(< /absolute/protected/admob-oauth.json)"
```

Delete the transient file after readback succeeds. Avoid this shell form on shared or audited machines if command substitution may be captured; use the protected-file mode directly there.

## Discovery

The helper reports counts and actions, never provider IDs or credential values:

```bash
uv run .codex/skills/provision-game-services/scripts/admob_provision.py diagnose \
  --keychain-service fabrikav2-admob-oauth \
  --keychain-account "$USER" \
  --account accounts/pub-REDACTED \
  --game-slug find-the-bird \
  --platform IOS \
  --store-id 6796698146 \
  --bundle-id com.basegamelab.findthebird \
  --country tr
```

For an existing oauth2l grant, pass `--oauth2l-credentials` with the owner-only OAuth client file and optionally `--oauth2l-cache`. The helper selects a cache entry only when client identity and both AdMob scopes match.

Classify failures:

- OAuth `invalid_client`: client was retired, rotated, or mismatched; create/adopt the intended client and consent again.
- OAuth `invalid_grant`: refresh token was revoked or expired; repeat interactive consent.
- API `401`: token generation or authorization header is invalid; never retry a captured access token.
- API `403` on v1beta create: monetization scope may be present while limited method access is absent; contact the AdMob account manager for enablement. This was observed on the Fabrika account on 2026-08-27: v1beta list succeeded, while the first exact iOS app create returned `PERMISSION_DENIED`; no app or unit was created.
- `ACTION_REQUIRED`: open the exact app in AdMob; the enum does not reveal the required remedy.
- Missing iOS storefront result: wait for App Store propagation; do not create an unlinked duplicate as a shortcut.

## Mutation gate

Before apply, present:

- AdMob account resource.
- Game and platform.
- Store ID and verified bundle/package identity.
- Whether the app will be created or reused.
- Which canonical units will be created.
- Public manifest path to be changed.

Store linking is irreversible. Require the operator to authorize this exact plan. Apply also requires `--confirm-link` equal to the store ID, preventing a generic confirmation from being replayed against another app.

```bash
uv run .codex/skills/provision-game-services/scripts/admob_provision.py apply \
  --keychain-service fabrikav2-admob-oauth \
  --keychain-account "$USER" \
  --account accounts/pub-REDACTED \
  --game-slug find-the-bird \
  --platform IOS \
  --store-id 6796698146 \
  --bundle-id com.basegamelab.findthebird \
  --country tr \
  --manifest games/find_the_bird/config/admob.public.json \
  --confirm-link 6796698146
```

The canonical units are `<game-slug>-<platform>-banner`, `-interstitial`, and `-rewarded`. Missing units are created automatically under the one approved convergence operation. Duplicate canonical matches, wrong formats, or multiple exact linked apps fail closed. Extra units are reported and never deleted or disabled.

After each mutation, the helper writes a local pending receipt containing only returned public object identities, then polls bounded readback. On a later apply, it reconciles every receipt identity against exact provider readback and removes the receipt only when all recorded objects are visible. An unresolved receipt blocks further creation without requiring manual deletion. This prevents retries from duplicating newly created objects that have not reached list consistency yet.

## Public manifest

The committed manifest contains public provider identifiers and runtime policy. It must never contain OAuth material, account payment details, or access tokens.

Production builds should use the committed manifest by default. Environment values may override public IDs for registered test traffic, emergency rotation, or local builds. Test-device IDs remain local because they identify operator devices even though they are not administrative credentials.

## Verification ladder

Report these independently:

1. OAuth refresh works.
2. Read-only account inventory works.
3. v1beta mutation capability works.
4. Exact store-linked app and canonical units exist.
5. Committed public manifest matches provider readback.
6. Native recipe and runtime resolve the same app ID.
7. A registered physical device loads and shows test banner, interstitial, and rewarded inventory.
8. Reward is granted only after the provider callback; failures grant nothing.
9. Consent and analytics behavior are observed.
10. Production serving and revenue appear in provider reporting.

Passing an earlier rung never proves a later one. Do not click production ads.
