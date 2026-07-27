# Marble Run v2 — v1 parity worklist (2026-07-27)

Single consolidated list, to be fixed in one pass. Sources: Batu's direct calls
on device, and a Pixelsmith panel sweep (6 judges: `codex/gpt-5.6-terra`,
`claude-fable-5`, `claude-opus-5`, `claude-opus-4.8`, `claude-sonnet-4.6`,
`gemini-3.5-flash`; the zoom judge skipped — no `ANTHROPIC_API_KEY`).
Score 76.5, verdict fail. Both captures on the same Pixel 6a at 1080x2400.

Reference builds now coexist on the Pixel:
- `com.basegamelab.marblerunv1` — "Marble Run v1" (shipping sugar3d build)
- `com.basegamelab.marblerun` — v2 port

The v1 rename was a temporary patch to the gitignored `android/` tree of
`fabrika/games/marble_run/sugar3d`; the project files were restored immediately
after the build, so the shipping config is untouched. Rebuilding v1 normally
produces the original package id again.

## Batu's direct calls (highest priority)

1. **Title text: remove the drop shadow.** v2's "Marble Run" carries a heavy
   dark-purple shadow; v1's lettering is flat brown. Confirmed independently by
   the panel ("heavier, more pronounced dark-purple shadow than the reference").
2. **Title text: remove the white outline/stroke.** v2 strokes the glyphs in
   cream/white; v1 has none.
3. **LEVEL button: remove the weird outline.** v1's button reads cleaner; v2 has
   an extra outline treatment around it.

## Panel findings — structural (multiple judges agreeing)

4. **Node connector rail is wrong.** v1 uses a warm tan/cream **double-rail
   rope** with darker edge shading; v2 renders a flat grey strip. Flagged by
   three judges, the loudest structural gap.
5. **Title plaque is too narrow.** v2 spans roughly x145–565; v1 spans x60–650,
   i.e. nearly full width with ~55px margins.
6. **Coin pill and settings gear are undersized** relative to v1, and sit at
   different positions.
7. **Sun badge numeral is oversized** — the number nearly fills the cream disc;
   v1's numeral is smaller and inset with visible padding. Two judges.
8. **Wooden node badges are too large**, and vertical spacing between nodes is
   tighter than v1's rhythm.

## Panel findings — colour / material

9. **Board frame is over-saturated** — v2 reads orange-red, v1 a muted brown.
10. **Background pattern density**: v1 carries large translucent marble/bubble
    watermarks across the field; v2's background is flatter with more loose
    confetti. (My observation; the panel did not flag it directly.)

## Platform-specific

11. **iOS-only: opaque rectangle behind the title banner.** WKWebView composites
    `filter: drop-shadow()` on the transparent banner PNG (`design/theme.ts:182`)
    with an opaque backing layer; Android's WebView does not. Verified by zoom on
    the iPhone 12 capture; the Android capture passes the `banner-transparency`
    recurring check. Likely resolved for free if the shadow work in item 1/2
    removes that filter — re-verify on device either way.

## Settings modal (captured 2026-07-27, same Pixel, both builds)

12. **Scrim is far too weak.** v1 dims the background to a near-black purple —
    the home behind is unreadable. v2's scrim is light enough that the banner,
    coin pill, gear, sun badge and LEVEL button all read clearly through it.
    Most visible difference on this screen.
13. **Close "X" is a circle; v1 uses a rounded square.** Note this contradicts
    the 2026-07-23 handoff's verified-good list, which records "square X" as
    achieved parity — so this is a regression, not an unported item.
14. **Card proportions.** v1's card is taller and vertically centred with
    generous internal padding; v2's is wider, sits higher, and its content is
    crowded toward the bottom edge.
15. **CLOSE button is undersized.** v1's is tall with a thick dark outline and
    clear margin below it inside the card; v2's is short, flatter, thinner
    outlined, and nearly touches the card's bottom edge.
16. **SETTINGS ribbon geometry.** v1's ribbon is wider than the card and its
    folded ends overhang both edges; v2's is narrower and tucked differently
    against the card top.
17. **Row label colour.** v1 uses dark navy/near-black; v2 uses purple.
18. **Row insets.** v1's rows have larger side margins inside the card; v2's run
    closer to the card edges.

## Explicitly NOT defects (do not "fix")

- Level number / coin balance differences between captures — different save
  states, not layout. The panel repeatedly flagged these despite the spec.
- Board preview rotation angle and marble positions — the decor board animates
  continuously, so phase differs per capture.
- Android status bar / home indicator visible in the v2 capture — capture
  artifact; v1's reference happened to omit it.

## Verification contract

After the fix pass, re-capture both builds on the Pixel at a matching state and
re-run:

```
cd /Users/base/dev/appletolye/pixelsmith && uv run pixelsmith judge \
  --capture <v2.png> --reference <v1.png> --spec <spec.txt>
```

Both apps now being installable side by side, matching states are cheap: launch
each package in turn on a fresh save. Motion (the menu→game transition) is NOT
covered by Pixelsmith — that needs recordings, per the 2026-07-23 handoff.
