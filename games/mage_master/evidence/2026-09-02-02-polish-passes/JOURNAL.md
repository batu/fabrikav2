# Passes 2–4 — polish on device (2026-09-02, 14:26–14:35)

Same lane as pass 1 (live dev server, tunnel screenshots, canvas frame bursts).
The phone save was manipulated through the dev drive (ladder unlocked, Rift at
max tier, backdated `lastSeenAt`) to reach states quickly; it is reset to a
fresh save before handover.

| File | State | Verdict |
| --- | --- | --- |
| dev-14-pause.png | pause, themed | panel sprite + primary/secondary buttons; gold title |
| dev-15-fail.png | defeat via forced outcome | DEFEAT ribbon, HUD dimmed dead mages, Retry / Home |
| dev-16-settings.png | settings | header below the notch (`--fab-safe-top`) |
| dev-17-rift-t7.png | rift at max tier | odds table shows the full ten ages, Ultimate 2% |
| dev-18-reveal-rare.png | legendary pull | orange rarity frame + pulsing glow, three-stat roll with deltas |
| dev-19-mages-geared.png | mages after equip | arcane staff on Ember's portrait and slot |
| dev-20-boss.png | (failed drive: level locked) | kept for the record |
| dev-22-offline.png | 2 h away | Welcome-back grant +60 gold +4 crystals; title shortened afterwards |
| dev-23-boss.png | L3 boss behind an unclaimed offline modal | exposed the rule: offline grants no longer overlay a battle |
| dev-25-wolves.png | L5 | forest palette, wolves face their targets |
| dev-26-slimes.png | L8 | swamp palette; chain bolt drawn from the caster (fixed), constant white flashes (fixed) |
| dev-27-slimes.png / frames-04.png | L8 after fixes | flashes rate-limited, deaths + coins + stage-clear sweep |
| dev-28-boss.png / frames-05.png | L3 boss wave | goblin chief at 1.6× with HP bar, Sage projectile in flight |
| app-icon.png | app icon (1024) | installed into native-resources + generated project |

## Landed in these passes

2× speed toggle, HUD gear portraits, per-family arena palettes, damage-number
spreading, equip/discard toasts, reveal entrance animation, offline grant on
foreground (`wake()`), procedural SFX on the sdk audio bus (hit, crit, death,
boss, heal, stage clear, win, lose, pull, rare, equip, coin, upgrade, tap).

## Not yet verified on device

Audio is inaudible in captures; verified only as "no runtime errors after
wiring" via the drive's error log. Motion at 2× speed not captured.

## Pass 5 — batch-2 chrome (14:46–14:47)

| File | State | Verdict |
| --- | --- | --- |
| art-batch-2.png | nav icons, ladder nodes, camp props | nine assets, first-attempt QA |
| dev-30-rift-fixed.png | rift at max tier | Skip bar no longer renders empty; upgrade block hidden at max |
| dev-31-reset-confirm.png | settings | two-tap reset confirmation toast |
| dev-32-home-final.png | home | generated node art on the ladder, cabin/gear nav icons |
| dev-33-battle-props.png | L2 S2 | tent + campfire on the ledge, generated pause icon |
| dev-34-settings-final.png | settings | generated back icon |
| dev-35-home-ladder.png | home | top node no longer clipped after node/gap retune |
| dev-29-speed2x.png / frames-06-speed2x.png | L4 boss at 2× | speed toggle highlighted, alpha wolf wave |

## Handover build (14:48)

| File | State | Verdict |
| --- | --- | --- |
| dev-36-standalone-home.png | standalone bundle, fresh save | launched from the installed bundle (no `server.url`, no ATS exception), app icon installed; locked-node numbers hidden in the follow-up install |

Install recipe: `vite build` (harness on) → `cap sync ios` → copy `native-resources/ios/App/` → `xcodebuild` (derived data in `.work/`) → `devicectl install` + `launch`. The dev-origin save is separate from the bundle-origin save, so the handover build starts fresh.

## Pass 6 — separation and summoning beat (14:52)

| File | State | Verdict |
| --- | --- | --- |
| dev-38-separation.png | L3 S2 melee | units hold distinct positions (soft separation in the sim, unit-tested: min pairwise distance > 8 world units over 20 s) |
| dev-39-summoning.png | rift after a pull | inconclusive on device: the offline modal pre-empted the reveal (dev save had been away 3 min). The 550 ms beat before the reveal is covered by the shell unit test with fake timers. |
