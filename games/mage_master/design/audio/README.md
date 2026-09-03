# design/audio

Shipped sound, generated 2026-09-03 with Stable Audio 2.5 through fal.ai
(`fal-ai/stable-audio-25/text-to-audio`, 8 inference steps) from the prompts
below, then processed with ffmpeg: effects trimmed of leading/trailing silence,
capped, faded out and normalised to -16 LUFS; music made seamless by crossfading
the last 2 s into the first 2 s (28 s loops) and normalised to -18 LUFS. All
files are 22 050 Hz mono 16-bit WAV: iOS WebKit cannot decode Ogg Vorbis, and
MP3/AAC encoder padding clicks on seamless loops.

Rights: generated audio under fal.ai's Stable Audio terms; confirm the current
Stability AI licence for commercial distribution before store submission.

| File | Used for | Prompt |
|------|----------|--------|
| music-menu.wav | home, rift, mages, shop, settings | Calm mystical fantasy game menu music, warm harp arpeggios and soft strings with a gentle glockenspiel melody, slow tempo, dreamy and magical, instrumental, loopable, no drums, no vocals |
| music-battle.wav | battle | Upbeat energetic fantasy battle music for a casual mobile game, driving drums, brass stabs and bright synth-orchestral melody, 128 bpm, heroic and fun, instrumental, loopable, no vocals |
| sfx-tap.wav | any button | soft short UI button tap click, clean and pleasant, mobile game interface sound, single click |
| sfx-hit.wav | hit (pitch-jittered) | short punchy magic staff melee hit impact on a goblin, fantasy game combat thump, single hit |
| sfx-crit.wav | critical hit | sharp critical hit impact with a bright metallic ring and crunch, fantasy game combat, single strike |
| sfx-death.wav | unit death | small creature defeat poof, soft thud with a short magical puff, cartoon fantasy game, single sound |
| sfx-boss.wav | boss entrance | deep ominous boss arrival hit, low drum boom with a dark bell toll, fantasy game, single sound |
| sfx-heal.wav | support heal | gentle healing chime, soft ascending sparkle bells, fantasy game support magic, single sound |
| sfx-stageClear.wav | stage clear | short triumphant stage clear jingle, three ascending bright notes with a sparkle, casual fantasy game, no vocals |
| sfx-win.wav | level won | short victory fanfare jingle, bright brass and bells, celebratory, casual fantasy mobile game, no vocals |
| sfx-lose.wav | level lost | short defeat jingle, descending sad notes, soft and gentle, casual fantasy mobile game, no vocals |
| sfx-pull.wav | rift summon | magical portal summon whoosh rising into a shimmer, fantasy gacha reveal sound, single sound |
| sfx-rare.wav | rare-and-above reveal | rare item reveal, magical sparkling chime cascade with a glowing shimmer, fantasy game, single sound |
| sfx-equip.wav | item equipped | equip armor sound, short leather and cloth rustle with a metal buckle click, fantasy game, single sound |
| sfx-coin.wav | discard / gold | short bright coin clink, a single gold coin dropped into a pouch, clean game UI sound effect |
| sfx-upgrade.wav | rift upgrade | upgrade complete power-up sound, rising magical tone ending in a bright chime, fantasy game, single sound |

Every cue also has a procedural voice in `src/game/sfx.ts` that plays until its
clip has decoded, or if a file is missing. Regenerate a cue by replacing its file.
