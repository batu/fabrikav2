# UI audio to source per game — the definitive list

Companion to GENERATION-LIST.md. Grounded in the shell's actual audio hooks:
every `play*` export in `src/audio/AudioManager.ts` plus interaction points
that currently ship silent. Today every UI sound is a synthesized WebAudio
beep (`playNotes`/`playNoise`); this list is the file-backed replacement set.

Format: mono OGG + M4A fallback (WKWebView), 44.1kHz, ≤150ms for taps,
peak-normalized to −3dBFS, zero leading silence (tap sounds must speak
within ~10ms of touch).

## A. Core button/tap layer (hook: `playUITap`, global button listener)

| # | Sound | Fires on | Brief |
|---|---|---|---|
| 1 | ui-tap | EVERY `<button>` press (global capture listener in AudioManager) | Soft rounded "pop/plip". The most-heard sound in the game — must be pleasant at 1000th press. |
| 2 | ui-tap-secondary | Back buttons, close X, cancel | Same family, lower pitch, softer. |
| 3 | ui-toggle-on / ui-toggle-off | Settings switches (music/sfx/haptics) | Tiny click pair, rising vs falling. |
| 4 | ui-reject | `playWrongTap` — locked saga node, disabled action | Muted double-thud "uh-uh". Not harsh; fires on frustrated repeat taps. |

## B. Progression + reward layer

| # | Sound | Fires on | Brief |
|---|---|---|---|
| 5 | level-win-sting | `playLevelComplete` — win overlay mount | 1–2s bright major sting; plays under confetti burst. |
| 6 | level-fail-sting | `playLevelFail` — Out of Lives overlay | 1–1.5s soft minor "aww" — sympathetic, never punishing. |
| 7 | coin-countup | Reward counter roll-up (LevelCompleteOverlay `animateNumber`) | Rapid coin-tick loopable grain (~60ms/tick) or single 800ms shimmer roll. |
| 8 | claim-thunk | CLAIM / CLAIM 2x press (distinct from ui-tap) | Satisfying weighty "chunk + sparkle" — the reward-banked moment. |
| 9 | confetti-pop | Confetti burst start (win overlay) | Short party-popper "foomp", layers under #5. |
| 10 | buttons-fly-in | Win/fail action buttons entrance (optional) | Feather-quick whoosh-pop, ≤200ms, very quiet. |

## C. Boosters + economy

| # | Sound | Fires on | Brief |
|---|---|---|---|
| 11 | hint-cast | `playHint` — hint/magnifier use | Magical "shing" sweep, ~600ms. |
| 12 | purchase-success | Shop buy confirmed (coins/hints/IAP) | Cash-register-meets-chime, celebratory but short. |
| 13 | purchase-fail | Purchase error / not enough coins | Gentle descending "nope", pairs with #4 family. |
| 14 | out-of-resource | Hint/lives depleted prompt opens | Soft empty-pocket flutter. |

## D. Navigation + transition layer

| # | Sound | Fires on | Brief |
|---|---|---|---|
| 15 | play-entry-whoosh | Play tap → pieces-fly-away transition (SceneTransitionCover revealing) | 900ms airy whoosh matching the fly-away choreography. |
| 16 | scene-return | Game → menu return | Shorter reversed-feel whoosh, ~400ms. |
| 17 | overlay-open / overlay-close | Settings/shop/pause modal in+out | Paired soft slide-pop, ≤250ms each. |
| 18 | saga-node-advance | New node unlocks on the saga map (after win) | Sparkly unlock "ding-tick", plays as the map scrolls. |

## E. Gameplay feedback (game-specific slot — regenerate per game)

| # | Sound | Fires on | Brief |
|---|---|---|---|
| 19 | success-tick set ×3–8 | `playFind` — correct gameplay action (FTD: dog found, round-robin `/audio/dog-found/*.wav`) | Per-game identity sound. Variants rotate to avoid fatigue. |
| 20 | voice-blip | `playVoiceBlip` — tutorial/dialog text tick | Animalese-style blip, only if the game uses dialog. |

## F. Music (Suno pipeline)

| # | Track | Fires on | Brief |
|---|---|---|---|
| 21 | music-menu | Home/menu ambient (AmbientManager `crossfadeTo`) | 60–90s seamless instrumental loop, upbeat-cozy (see Suno prompt in session notes). Replaces `/audio/velvet-ii-v.mp3`. |
| 22 | music-gameplay | In-level ambient | Same family, more minimal — melody thinned so it never fights focus. |

## Wiring notes

- `AudioManager.playNotes` beeps stay as the FALLBACK when a file is missing —
  file-backed playback should reuse the dog-found pattern: fetch + decode once
  into AudioBuffers, play via the shared AudioContext (autoplay-gate safe).
- All sfx obey the existing settings toggles (`sfx`, `music`) — no new gates.
- Ship-blocker set for a new game: #1, #4, #5, #6, #8, #11, #19, #21. The
  rest polish.
