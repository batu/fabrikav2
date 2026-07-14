# U6 Phaser-native runtime proof

Date: 2026-07-14

## Selected immutable revision

- accepted role: `B`
- source publication: `sha256-132969b9fa15bbe89e91c9ee5900a2f3e953a76a1bb22e50f1d8972e196a7c56`
- applied projection: `sha256-42f2a6ef36c7cde7dcd3a759a32832f786e346751091c8a12e09f6538f61c4ea`
- renderer: Phaser 4.2.1, explicit WebGL

The real game directory was exercised through P0 -> A -> B -> B. The final B
application returned `no-op`, leaving the pointer and projection bytes unchanged.
Before boot, the runtime now fails closed unless the selected revision path,
artifact coverage, byte counts, and SHA-256 hashes all match that pointer.

## Physical-device evidence

`verify-device` built the production Vite bundle, synchronized the Capacitor
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
run as `no-applicable-evidence`, not a fidelity pass, because this scaffold has
no trusted reference images. This is live-device runtime proof, not a
reference-comparison claim.

## Host verification

- Phaser shell: typecheck passed; 202 unit tests passed.
- Phaser proof game: typecheck passed; 95 unit tests passed.
- Runtime-owned source lint and the repository audit passed. Full game lint
  still reports inherited Editor-generated `Semantic.ts` `any` declarations.
- Production Vite build and a served-dist boot passed with the exact immutable
  publication/projection identity and one WebGL canvas.
- Browser runtime drove all seven states with `ready=true` and exercised real
  canvas pointer input at the edge of the full 294x60 Claim surface, then
  exercised the 48px-minimum Next control and observed the controller transition.
- Evidence action geometry reports the full authored Menu, Claim, Claim Double,
  icon, and Settings-toggle surfaces rather than text-label bounds.
- `git diff --check` passed.
- Fence audit reports only inherited prerequisite/integration drift; U6's
  earlier package, Playwright, e2e, and Vite config violations were removed.
