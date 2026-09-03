# 2026-09-03 — generated music and sound effects

Batu: "generate music and simple sound effects" → "Can you not generate it?"
(after a first pass with Kenney CC0 clips). Generation lane that worked:
fal.ai `fal-ai/stable-audio-25/text-to-audio` (8 steps). Lyria 2 on fal was
"downstream service unavailable" twice; the ElevenLabs key lacks the
`sound_generation` permission; the Palmier MCP needs its editor open; the
HeyGen CLI is not installed. 18 Stable Audio calls (2 probes + 16 assets);
fal exposes no usage meter from here — read the spend on the fal dashboard.

Pipeline (`design/audio/README.md` has every prompt): effects trimmed of
silence, capped, faded, -16 LUFS; music normalised to -18 LUFS first, then
cut into a seamless 28 s loop by crossfading the last 2 s into the first 2 s
(the loop's end sample and start sample are consecutive source samples).
22 050 Hz mono 16-bit WAV, 3.2 MB total.

Playback: `src/game/sfx.ts` keeps a procedural voice per cue and prefers the
decoded clip; `hit` is pitch-jittered ±8 %. Music loops on the bus's music
channel, crossfades menu ↔ battle on page change, follows the Music setting,
and resumes when the app returns to the foreground.

## Evidence

- Seam check: menu loop |end−start| 0.031 vs normal consecutive-sample steps
  p50 0.012 / p99 0.058; battle 0.0024 vs p50 0.008 / p99 0.107 → no click.
- `wave-music-menu.png`, `wave-music-battle.png`, `wave-menu-seam-tail2s-head2s.png`
  (last 2 s followed by first 2 s, continuous), `wave-sfx-sheet.png`.
- On the iPhone (drive `eval` of `__MM_DEV.sfx.debug()` after a tap):
  menu `{state: running, clips: 14, tracks: 2, track: menu, level: 0.041}`;
  in battle `{…, track: battle, level: 0.199}` then `0.056` a second later.
  The level is the RMS of an AnalyserNode on the bus master, i.e. real output.

Not audited by ear here: whether each generated cue suits its moment. Any cue
is swappable by replacing its file; the prompt table is the regeneration recipe.
