# Find the Dog environment contract

`games/find_the_dog/.env.example` is the canonical 57-variable release surface. It contains placeholders only. Real values belong in ignored local files such as `.env.ios.local` and `.env.android.local`; they must never be committed, pasted into Trello, included in evidence, or printed into build logs.

## What is sensitive

Credential-bearing client configuration includes Firebase identifiers, GameAnalytics game/secret keys, RevenueCat public SDK keys, Adjust app/event tokens, AppLovin SDK and placement IDs, AdMob unit IDs, and the owned-analytics public client key. Treat these as operator-sensitive even though every `VITE_*` value included in a web bundle can be extracted by an app user. This surface is therefore suitable only for client credentials intended to ship with the app.

Never put server-grade or private credentials here. RevenueCat server secrets, GameAnalytics Metrics API keys, Cloudflare/R2 credentials, Firebase operator OAuth tokens, signing keys, and similar administrative credentials belong in the appropriate secrets manager or operator environment, not in any `VITE_*` file.

Booleans, the Adjust environment name, public legal/support/store URLs, CDN origins, and the owned-analytics endpoint URL are not secrets. They remain part of the tracked contract because they control release behavior, but real deployment values still live in the ignored mode-local file.

## Validation behavior

The shared validator resolves the game by `--game` and supports `ios` and `android` modes. Normal validation requires explicit, recognized booleans for the mode's provider/CDN intent. When a provider is enabled, its active runtime credentials become mandatory:

- iOS GameAnalytics requires its game key and secret key.
- iOS Adjust requires its app token and a `sandbox` or `production` environment.
- AppLovin requires the selected platform SDK key and `GENERAL_AUDIENCE_ONLY=true`.

Firebase and RevenueCat remain optional because their v2 consumers are not wired yet. CDN origins remain optional because the runtime has bundled/default fallbacks. Legal URLs, AdMob IDs, AppLovin placement IDs, Adjust event tokens, and mirror settings retain their current runtime defaults when unset.

The validator also rejects a blank `.env.<mode>.local` assignment that would replace a non-empty lower-precedence value. A nearest preceding comment containing `intentional-blank` permits a deliberate blank only for an optional value; it never satisfies a required key.

Run the hermetic self-test without reading any real configuration:

```sh
cd games/find_the_dog
node ../../tools/game-env/validate.mjs --game find_the_dog --mode ios --dry-run
```

`--dry-run` proves synthetic passing and deliberate failure cases. It is not release validation, and it must not appear in a build script. Normal release validation is the same command without `--dry-run`.

## Current real-value custody and conductor transfer

The currently named source of real iOS values is the read-only v1 file:

`/Users/base/dev/appletolye/fabrika/games/find_the_dog/.env.ios.local`

Do not copy that file into Git, a comment, or evidence. The conductor performs the transfer locally after this branch lands:

1. Confirm the source is a regular, non-symlink file. Refuse the transfer if either source or destination is a symlink.
2. Set `umask 077`, create v2 `games/find_the_dog/.env.ios.local` with owner-only permissions, and use trusted local editors to transfer only the canonical names needed for iOS. Do not use commands that echo values to the terminal or logs.
3. Run `chmod 600 games/find_the_dog/.env.ios.local`, then inspect only ownership and mode with `stat`; never inspect contents in recorded output.
4. Confirm `git check-ignore -v games/find_the_dog/.env.ios.local` reports an ignore rule and `git status --short` does not list the file.
5. Run normal validation. It reports key names only when configuration is missing or invalid:

   ```sh
   cd games/find_the_dog
   node ../../tools/game-env/validate.mjs --game find_the_dog --mode ios
   ```

6. Treat any bundle produced with real values as transient and non-shareable. Remove only `games/find_the_dog/dist` after success, failure, or an interrupted verification run.

## Excluded runtime knobs

The exact 57-key contract deliberately excludes test-only and tuning-only reads such as `VITE_ENABLE_TEST_HARNESS`, `VITE_FTD_FAST_E2E_UI`, `VITE_FTD_FORCE_CANVAS`, and `VITE_FTD_SIM_AUTOPLAY`; their default is off. It also excludes owned-analytics enable/tuning keys, so that mirror remains disabled unless its owning runtime card establishes a broader contract. Existing Keymaster-owned AppLovin ad-unit constants and historical env aliases keep their current source/default behavior. Do not add these exclusions to `.env.example` as aliases.

## Package-script handoff

This card does not edit `package.json`. Card 1 should add these exact script values later:

```text
build:ios = node ../../tools/game-env/validate.mjs --game find_the_dog --mode ios && vite build --mode ios
build:android = node ../../tools/game-env/validate.mjs --game find_the_dog --mode android && vite build --mode android
dev:ios = vite --mode ios
```

V2 has no applicable post-Vite dist-packaging suffix, so none should be copied from v1.
