# Protected credential and identity readback

Date: 2026-08-28

- Find The Bird Firebase project: `find-the-bird-basegamelab`
- Find The Bird bundle: `com.basegamelab.findthebird`
- Find The Dog Firebase project: `find-the-dog-basegamelab`
- Find The Dog bundle: `com.baseardahan.hiddenobj`
- Firebase CLI returned one matching iOS app in each dedicated project.
- Owner plists are stored outside Git under `~/.config/base-game-lab/firebase/find-the-{bird,dog}/GoogleService-Info.plist`, mode `0600`.
- Native-shell validation requires exact `BUNDLE_ID`, canonical `PROJECT_ID`, and a well-formed `GOOGLE_APP_ID`.
- `hidden-object-base` is explicitly rejected for new Find builds.
- AppsFlyer developer key remains owner-only under `~/.config/base-game-lab/appsflyer-dev-key`; no value was read into this receipt.

Credential values are intentionally omitted.
