# Marble Run physical-Android editor baseline

This directory contains six accepted, fresh Pixel 6a captures of the installed
Marble Run package. It is a **partial** primary-state baseline, not a complete
U0/menu baseline and not proof that the APK bytes were built from the intended
git SHA.

## Accepted current captures

`captures/` contains `menu`, `gameplay-hud`, `pause`, `settings-menu`,
`settings-level`, and `shop`. Every PNG is a raw 1080 x 2400 RGBA Android
screenshot. `provenance.json` binds each byte to its action path and hash.

## Honest blockers

`win`, `fail`, and `finale` remain required editor targets, but no current
Marble Run device reference was captured. The installed production-style APK
does not expose the test harness, the board was not solved or failed during the
capture timebox, and the finale was not independently reached. Browser images,
older screenshots, and captures from another package are not substitutes.

## Rejected captures

No rejected PNG is committed here. During collection, Android Back from Shop
exited Marble Run and exposed `com.fabrika.shellproofphaser`; six subsequent
frames belonged to that other app and were quarantined in the temporary capture
workspace. This is why the recipe requires a foreground-package assertion
before and after every action and screenshot. Shop Back exiting Marble is an
observed product defect, not an editor target or a reason to accept cross-app
evidence.

The exact editor inventory remains all nine primary surfaces listed in
`authoring/reference/screens.yaml`. Mechanics and transient overlays are
explicitly excluded.
