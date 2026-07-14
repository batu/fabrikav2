# U6 Phaser-native runtime proof

Date: 2026-07-14

## Selected immutable revision

- accepted role: `B`
- source publication: `sha256-132969b9fa15bbe89e91c9ee5900a2f3e953a76a1bb22e50f1d8972e196a7c56`
- applied projection: `sha256-42f2a6ef36c7cde7dcd3a759a32832f786e346751091c8a12e09f6538f61c4ea`
- renderer: Phaser 4.2.1, explicit WebGL

The real game directory was exercised through P0 -> A -> B -> B. The final B
application returned `no-op`, leaving the pointer and projection bytes unchanged.

## Physical-device evidence

`verify-device` built the Vite bundle, generated and synchronized the Capacitor
Android project, assembled the debug APK, installed it on Pixel 6a
`27091JEGR22183`, and captured all seven gated states: menu, level, shop,
settings, pause, win, and fail. Raw screenshots are in `raw-captures/`.

After a clean app restart, Android logcat reported:

```text
Phaser v4.2.1 (WebGL | Web Audio)
[fabrikav2:projection-ready] {"gameId":"shell_proof_phaser","publicationId":"sha256-132969b9fa15bbe89e91c9ee5900a2f3e953a76a1bb22e50f1d8972e196a7c56","projectionId":"sha256-42f2a6ef36c7cde7dcd3a759a32832f786e346751091c8a12e09f6538f61c4ea"}
```

Every screenshot visibly carries `PHASER · 42f2a6ef`, independently tying the
rendered pixels to the selected projection. The device verifier classified this
run as `no-applicable-evidence`, not a fidelity pass, because this scaffold's
manifest intentionally has no trusted reference images. That does not weaken
the live-device runtime/application proof; it means no reference-comparison
claim is made.

## Host verification

- Phaser shell: typecheck and lint passed; 201 unit tests passed.
- Phaser proof game: typecheck passed; 95 unit tests passed.
- Runtime-owned source lint passed. Full game lint still reports the inherited
  Editor-generated `Semantic.ts` `any` declarations frozen into U5 publications.
- Production Vite build passed.
- Browser runtime drove all seven states with the matching probe state,
  post-render `ready=true`, semantic action rectangles, renderer
  `phaser-native`, and sentinel `42f2a6ef`.
- Two Phaser 4.2.1 Playwright interaction proofs passed, including a real
  pointer-driven Claim -> Next transition with state-dependent visibility and
  disabled evidence.
- `git diff --check` passed.
