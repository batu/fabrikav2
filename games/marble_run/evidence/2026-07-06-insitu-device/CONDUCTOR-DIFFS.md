# In-situ device diffs — conductor's list (blind; Batu's list pending)

Method: XCUITest runner on the physical iPhone 12 (real taps + XCUIScreen
captures), compared against refs/captures/android-basegamelab/ and the browser
differential (docs/evidence/2026-07-06-ui-differential/, 13 findings F1-F13).
Device evidence in this dir. New = not in the browser differential.

## NEW, device-only

D1 (P1, high) — SAFE-AREA INSETS NOT APPLIED. The iOS status bar (clock,
battery) renders OVER the coin pill / hearts panel / settings gear on both menu
and level (01-menu, 03-level, p3). The gear's hit region (y 16-68) sits in the
status-bar zone, so top-edge taps are partially system-shadowed. Reference
keeps all chrome below the notch area. Fix: viewport-fit=cover +
env(safe-area-inset-top) padding on the #ui top chrome (token:
--fab-safe-top), verify in Capacitor config.

D2 (P2, high) — AMBIGUOUS ACCESSIBILITY VOCABULARY. Saga nodes and the primary
CTA all expose label 'Level N' (a11y tree: node 'Level 7' matched before the
CTA); the CTA should be distinct ('Start level 3'), nodes should carry
locked/unlocked state. Cost: broke label-driven automation; also a real
VoiceOver quality issue. Fix: aria-labels in SagaMap + HomeMenu CTA.

D3 (P3, med) — STATUS BAR STYLE. Black status-bar text on the purple theme;
should be light-content for legibility (Capacitor StatusBar config).

## CONFIRMED IN SITU (browser findings that hold on device)

- F1 menu composition: saga chain overlaps the tilted board on device too
  (01-menu). Reference: small top-anchored board, chain below in clear space.
- F8/F9/F11 chrome quality in level (p3): emoji hearts in the pill (ref:
  drawn heart panel), flat grey gear, HINT tile grey-lavender with silver coin
  (ref: warm tan, gold coin), silver coin icon in coin pill (ref: gold).
- Background: dot pattern present ✓ but character differs from ref's marble
  motifs (F12).
- Board camera in level: straight top-down, fills width — GOOD on device
  (fidelity fix confirmed in situ).

## RESOLVED / NOT A BUG

- 'All taps dead on device' from the first tour: FALSE ALARM — input works
  (level started via coordinate tap, p3). Real causes: D1 (gear under status
  bar) + D2 (label matched a locked node). Chromium real-click e2e remains
  valid; the device lane now exists (XCUITest runner in .work/insitu-runner,
  promotable to template per capability wishlist item 2 — now CLOSED).

## Notes for grading
Browser differential F2-F7, F10, F13 not re-tested in situ (states not
reachable without solving; win/fail refs still pending on Android side).

## UPDATE — all 5 states now captured in situ (win/fail via dev-bundle tour)

Method addition: a dev-gated in-app tour (src/testing/insituTour.ts, VITE_INSITU_TOUR
flag, harness-only) self-plays L1 to WIN via tapUnlockedMarble then to FAIL via
tapBlockedMarble, bundled statically (no LAN/ATS dependency — the dev-server-URL
attempt failed on device). XCUITest caught both result cards by label. Shipping
bundle rebuilt clean afterward (no tour/harness).

New findings from the two result screens (05-win, 06-fail):

D4 (P2, high) — RESULT CARD IS NOT A DIMMED-SCRIM MODAL. Both win ('Level
Complete') and fail ('No Hearts Left') render as an opaque card on the flat
purple body with the game GONE behind it — same F5 class as settings/pause.
Reference language floats the card over the dimmed board. High-visibility on
the two most-seen monetization screens.

D5 (P2, med) — WIN CARD CHROME below reference bar: cream card + orange 'Next'
(the F3 accent-flip again, now on the reward screen), a generic gold-disc art
with a scribble globe, and coins shown as a bare '25' number + a tiny gold coin
stack orphaned bottom-left (no animation target visible in the still). Compared
to the app's own menu banner richness this reads flat.

D6 (P3, med) — FAIL card 'Watch Ad' is the orange primary and reads fine, but
'No Hearts Left'/'Watch an ad to keep this run going' is plain-web-dialog styled
(centered sans text, no game framing/ribbon). Fine functionally, weak in
character vs the settings ribbon treatment.

D7 (P1-for-monetization, med-conf) — the WIN reward and coin-fly: the '25' and
the orphan coin stack suggest the coin-fly-to-balance (EconomyTransfer) may not
be firing on the result card, or its target anchor isn't the win-card balance.
Worth a live check — if reward coins don't visibly fly, that's a felt-value
regression on the core reward moment. (Flagged med-conf: single still, motion
unverified.)

Coverage now: menu, settings(modal), level, pause, win, fail — all on device.
Remaining gap: no ANDROID reference for win/fail/pause yet (pending adb capture),
so D4-D7 are judged against the app's own established language + the browser
differential, not paired references.
