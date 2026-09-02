# Marble Run difficulty editor

Game-owned React/TypeScript authoring tool for Marble Run's 110-level difficulty journey. It edits an autosaved local draft, generates boards through the game generator, and produces an explicit migration candidate. Exporting does not modify game source, select runtime content, publish Portal, or change a device.

## Commands

```sh
npm run dev -w @fabrikav2/marble-run-difficulty-editor
npm run test:unit -w @fabrikav2/marble-run-difficulty-editor
npm run typecheck -w @fabrikav2/marble-run-difficulty-editor
npm run lint -w @fabrikav2/marble-run-difficulty-editor
npm run build -w @fabrikav2/marble-run-difficulty-editor
```

The production build uses relative asset URLs (`base: './'`) and writes `dist/build-manifest.json`. The manifest is deterministic and contains the editor package version, base path, aggregate content hash, and sorted SHA-256 digest/byte count for every emitted asset. Portal must retain and serve the complete directory under its immutable content hash; it must not rewrite the artifact or treat it as a runtime Marble Run revision.

## Export boundary

`createExportReview` validates the exact candidate later downloaded. `prepareCandidateDownload` fails closed if the draft changed after review, validation no longer passes, or the canonical bytes/fingerprint differ. The UI must call `triggerCandidateDownload` only after explicit review confirmation. Migration, source diff review, physical-device verification, commit, and release remain a separate engineering workflow.
