# Wool Crush - design brief

Game id: `wool_crush`

Status: DRAFT under discussion. Primary source: Batu's play-knowledge (dictated 2026-07-09).
Secondary: conductor web research + reference-frame evidence. Claims carry source + confidence.
The reference video (`refs/video/woolcrush-reference-video.mp4`) remains ground truth; the
hardened step-4 tool (claims-view, twf card Yg2DZKNO, parked) will timestamp-verify these later.

## Core loop [Batu, HIGH]

- A **dragon slithers along a track toward a cat**. The dragon's body is made of
  **sections, each a colored yarn**.
- The **lower half** of the screen is a board of **yarn threads**: straight items, each with a
  **direction and a length**. Tapping a thread slides it straight along its direction and
  **out of the board** — unless another item blocks its path, in which case it cannot move
  (Parking Jam movement rule; threads are straight, never bending).
- A thread that exits the board occupies one of **4 slots** ("yarn spools"). Only 4 can be
  active at once.
- The **lower half of the dragon's path is accessible**. When the dragon comes close, any slot
  spool whose **color matches a dragon yarn section starts pulling it** — this **pushes the
  dragon back**. When the spool has pulled its full **length** worth of yarn, the spool
  **completes and disappears**, freeing its slot.
- The game is **smart sequencing**: choose which threads to release into the limited 4 slots so
  their colors match what the dragon is bringing. Fill all 4 slots with colors the dragon
  doesn't currently offer (e.g. 4x teal vs a red/blue/green dragon) and you can pull nothing —
  **effectively dead** (soft-lock).

## Win / fail [Batu + inference, MEDIUM — confirm]

- Win: dragon fully unraveled (all sections pulled) before it reaches the cat. [inference]
- Fail: dragon reaches the cat, or slot deadlock (4 unmatchable spools). [Batu: deadlock = death]

## Mechanics resolution [Batu, 2026-07-09 — HIGH, build against these]

1. **Pull:** a spool of length N pulls exactly N yarn sections, always the **closest matching
   section**. When several spools are active, the **closest-to-finish spool finishes first**.
2. **Dragon motion:** constant forward speed; while being pulled it shortens at the pull rate,
   so it **effectively stays in place during a pull**.
3. **Slots:** free only when a spool completes. (Discard/swap are sellable boosters — later.)
4. **Levels:** single layout style. A level = the thread map; win = **finish the map** (clear
   all threads). Dragon length is **derived from the board**: more tiles ⇒ longer dragon.
   Invariant: dragon sections per color == total thread length per color (conservation).
   Never more than 4 slots. v0: ~3 levels; level 1 = ~6 tiles, very simple; grow difficulty.
5. **Boosters: none in v0.**
6. **Warehouse boxes: none in v0.** (Their role: they spawn new tiles — for later.)
7. **Blocking:** only other threads. No walls/obstacles in v0.

## v0 scope

- 3 levels, single layout style, 4 slots fixed, no boosters, no warehouse, no timers.
- Fail = dragon reaches the cat, or 4-slot deadlock (no spool matches any remaining
  accessible dragon section AND no thread can be released).
- Minimalist gameplay rendering (dragon = curving line of colored sections); full-clone shell.

## Meta & monetization [frames + web, MEDIUM]

- Currency: coins (paw icon). Shop: gift packs, coin tiers (500-25000), VIP/IAP passes
  (`ios_iap_pass_1/2` placeholders visible), 90%-off banners. Interstitial-heavy per reviews.
- Tutorial pattern: mechanic-teach modals mid-level (warehouse @ 6:44).
- "Wool Crush" is a publisher reskin umbrella (4-5 mechanically different variants);
  ours is the dragon/thread-pull variant. Closest listing candidate: App Store id 6743385713.

## Feel

Cheerful, plush, tactile, bright, toy-like (see `design/ai-asset/style_guide.yaml` —
frame-sampled). Tension comes from the dragon's approach vs slot economy, not from timers.

## Constraints / build directive [Batu, 2026-07-09 — binding]

- **Gameplay rendering: minimalist for now.** Dragon = simplified curving line; yarn collection
  simple. Good animations later; do NOT block gameplay on dragon art.
- **Everything else — menus, shell, assets — is a full asset clone** of the reference
  (style guide + design sheet pipeline landed 2026-07-09).
- Mobile device-first as per repo law; states in `refs/manifest.yaml` (9 states, 15 refs).
