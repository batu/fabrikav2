# Game release commands

`cli.mjs` is the JSON manifest and direct iOS release API. `portal-executor.mjs`
is the directly executable adapter for Portal's `JsonCommandExecutor`; it reads
exactly one `{run,step,settings}` object from stdin and writes one closed
`{outcome,receipt}` object to stdout.

Portal discovery uses `cli.mjs` with `command: "identity"`. That read-only
boundary requires the exact clean source revision and returns only the game
name, production bundle ID, platform, source revision, and native-recipe digest.
It deliberately does not require production environment materialization or a
generated native shell. The default `manifest` command remains the build
preflight and still requires both.

Production Portal discovery invokes `identity-executor.mjs` directly, never
`node` through `PATH`. Its absolute shebang and pre-input integrity check pin
the Node binary, identity CLI, manifest reader, game-env/native-shell
transitives, and Find the Dog native recipe. Portal configuration must pin the
wrapper's own executable digest before invoking it.

Approved build settings use this shape:

```json
{
  "executor": "build",
  "command": ["/absolute/fabrikav2/tools/game-release/portal-executor.mjs"],
  "repo_root": "/absolute/fabrikav2",
  "environment_ref": "file-ref:/absolute/external/find-the-dog-ios.env"
}
```

Physical-device capture settings add these non-secret, approval-bound values:

```json
{
  "executor": "device",
  "command": ["/absolute/fabrikav2/tools/game-release/portal-executor.mjs"],
  "repo_root": "/absolute/fabrikav2",
  "environment_ref": "file-ref:/absolute/external/find-the-dog-ios.env",
  "evidence_ref": "file-ref:/absolute/evidence/post-launch.png",
  "development_team": "APPLE_TEAM_ID",
  "max_artifact_bytes": 500000000
}
```

`device.capture` (and the compatibility alias `device.release`) performs the
harness-free signed build, exact replacement install, launch, installed-app
query, and diagnostic screenshot. It emits a `staged_ios_release_candidate`
that binds source, manifest, canonical payload, full signed app, build ID,
signing identity, and physical device. It does not accept or emit a gameplay
pass. Portal must retain that receipt unchanged in `run.receipts`.

After an independent reviewer approves gameplay from that installed candidate,
`device.finalize` or `device.exact_release` uses the same settings except
`evidence_ref`, and adds:

```json
{
  "gameplay_evidence_ref": "file-ref:/absolute/evidence/reviewed-gameplay.png",
  "review_public_key_ref": "file-ref:/absolute/authority/review-public.pem"
}
```

Finalize re-hashes and re-verifies the staged `.app`, its code-signing identity,
the unchanged source revision, current physical-device install identity, and
Portal's authenticated review. It emits `exact_release_candidate` without a
second build or install.

The environment, reviewed gameplay artifact, and public-key file must be
owner-controlled regular files. Symlinks and group/world-readable sensitive
inputs are rejected. The gameplay review receipt and its signed identity come
from Portal's append-only `review_audit_receipts`; secret values never appear in
the executor response.

`build.release` and `build.diagnostic` invoke the existing release-manifest
validator. Provider and browser steps are rejected by this executable.

Before importing release code or reading the worker payload, the executable
verifies its pinned Node executable plus the complete declared build/device
runtime graph: release modules, game-env policy and CLI layers, native-shell and
device helpers, Find the Dog Vite/Capacitor build configuration, package
manifests, and lockfile. Any drift produces `executor_integrity_failed`. Every
critical layer has a mutation test; adding an imported or directly invoked
release tool requires adding it to both the graph and that test matrix. Portal
separately approval-hashes the executable wrapper itself.
