# Marble Run native Phaser Editor open proof

Status: **PASS for native project compatibility and scene rendering.** This does not close save/reopen, device fidelity, or PixelSmith review.

On 2026-07-15, the installed vendor server from `/Applications/Phaser Editor 5.app` (version 5.0.2) was launched loopback-only against `games/marble_run/authoring/phaser-editor/project` with browser auto-open and update checks disabled.

The vendor `GetServerMode` response reported:

```json
{ "desktop": true, "unlocked": true, "externalEditorName": "Visual Studio Code", "licenseOwner": "" }
```

In a clean headless browser session, the actual Phaser Editor workbench opened `src/scenes/Menu.scene`. The native Scene Editor canvas rendered the exact Marble banner, coin, gear, level-node assets, native primitives, and 390 × 844 border. Its Files view showed all nine `.scene` authorities and its Asset browser showed the exact-game curated pack. There were no page or console errors. After capture, the vendor process was stopped and the loopback endpoint refused connection.

Artifacts:

- `Menu-native-editor.png` — actual Phaser Editor 5 workbench, not the read-only Preview
- screenshot SHA-256: `dfd352b342a12e717461910bb3fdd399b9f49f36c59ecf664c84c0ec38814ae8`
- opened Menu.scene SHA-256: `bdba1bff7c4f8a09d3d976d4ad2a899b87cfe257cb632fbb4dce990eea3f5b07`

Remaining conductor proof: select nested hierarchy elements, perform an editor-native mutation/save, fully restart/reopen, regenerate/publish, and compare the matching revision on physical Android. No claim in this report substitutes for those gates.
