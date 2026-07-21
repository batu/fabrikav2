---
status: passed
subject: Hermetic shell-template app-icon provenance and native recipe copy
created: 2026-07-21
mode: pipeline
contract: headless-logic
---

# Evidence: Hermetic shell-template app-icon provenance and native recipe copy

## Verdict

Fresh headless-logic evidence confirms that the shell-template app icon resolves from a committed native recipe, copies into the generated Xcode App target without an extra `App` directory, remains byte-identical to the design icon, and leaves the root audit green.

## What Changed

- Pointed the app-icon source at `native-resources/ios/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` and retained `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` as the generated runtime path.
- Flattened the committed iOS recipe by one `App` directory so `applyNativeRecipe()` writes assets and `Info.plist` into Capacitor's generated Xcode App target.
- Updated create-game substitutions and tests for the flattened recipe, and added a focused regression that copies the real shell-template icon into a temporary generated runtime tree.
- Moved seven recipe files as 100% renames; PNG, JSON, and plist bytes did not change.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| historical baseline | Archive `acc63eae`, run current `lintAssetIdentity()`, filter `games/shell_template/design/assets/app-icon.png` | reproduced `[SOURCE-MISSING] source=ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png source file does not exist` |
| focused regression | `npm exec -- vitest run tools/verify-device/test/steps.test.mjs tools/create-game/test/create-game.test.js tools/audit/test/asset-identity.test.js` | passed: 3 files, 35 tests; includes real shell-template recipe copy into `ios/App/App/Assets.xcassets` and rejects a triple-`App` output |
| repository audit | `npm run audit` | passed with pre-existing warnings only; no shell-template app-icon error |
| manifest assertion | Parse `games/shell_template/design/asset-identity.json`, assert exact source/runtime paths, source existence, and tracked recipe file | passed |
| byte identity | `shasum -a 256 games/shell_template/design/assets/app-icon.png games/shell_template/native-resources/ios/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` | both `8062702ea9e5de0590cc2147b3aa9f76533b397ea0045425d4009c5677f85d11` |
| recipe preservation | `git diff --summary 84b67df6..c196631e -- games/shell_template/native-resources/ios/App` | seven 100% renames; no recipe byte changes |
| diff integrity | `git diff --check 94d6cd16..HEAD` and `git diff --check` | passed |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| Not selected | n/a | This is a non-visible provenance/copy-path repair; no UI, motion, interaction, or gameplay-feel behavior changed, so a visual reviewer would add no relevant signal. |

## Gaps

- None. Physical-device visual capture is not applicable to this headless-logic contract because image bytes and rendered behavior are unchanged; the focused copier regression directly observes the changed runtime-path behavior in a temporary generated Xcode tree.
- The card's literal `node --test tools/audit/test/asset-identity.test.js` is not a valid runner for this Vitest-authored suite. The repository-native Vitest invocation passed all eight asset-identity tests as part of the 35-test focused run.

## Next Action

None.

## Pipeline Result

```json
{
  "skill": "ce-evidence",
  "status": "passed",
  "artifact_path": "games/shell_template/evidence/2026-07-21-app-icon-audit-hermetic/evidence.md",
  "verdict": "Fresh headless-logic evidence confirms the shell-template app icon is sourced from a committed recipe, copied into the generated Xcode App target, byte-identical to the design icon, and accepted by the root audit.",
  "mode": "pipeline",
  "evidence": [
    {
      "type": "test",
      "label": "focused native-recipe, create-game, and asset-identity suites",
      "result": "passed: 3 files, 35 tests",
      "path": null,
      "url": null
    },
    {
      "type": "audit",
      "label": "root repository audit",
      "result": "passed with pre-existing warnings only",
      "path": null,
      "url": null
    },
    {
      "type": "provenance",
      "label": "historical SOURCE-MISSING reproduction and repaired path/hash assertions",
      "result": "passed",
      "path": null,
      "url": null
    }
  ],
  "reviewers": [],
  "gaps": [],
  "next_action": null,
  "pr_updated": false
}
```
