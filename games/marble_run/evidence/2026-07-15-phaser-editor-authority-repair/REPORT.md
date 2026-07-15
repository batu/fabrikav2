# Marble Run Phaser Editor authority repair

Status: **PASS for the six independent code-review findings.** This report supersedes the earlier no-op persistence claim; physical-device runtime projection remains MR4 scope.

## Publication and Preview integrity

The active saved-scene publication is `sha256-ffa1e20b2acdfd848bbdc12d6bcc4c7560e30e5eb5d76f8277ed6836639f62ad`. Its revision is computed over the complete ordered authority preimage. Publication reuse now recomputes and compares every source byte with the frozen preimage and its revision digest. `status` fails closed when either representation is modified.

Publication is also transaction-safe against concurrent native-editor saves. It validates one isolated capture, derives both the destination revision and `authority.bin` from those exact staged bytes, atomically renames the capture, verifies the completed destination, and atomically replaces the active pointer. A regression test changes the live Menu scene immediately after capture and proves the immutable publication retains the captured scene, verifies under its own revision, and does not falsely claim the later working revision. Any newly renamed destination that fails verification is removed before the error escapes.

Reset stages all twelve protected replacements plus all twelve working originals before touching the project. A forced failure after several replacements proves that rollback restores every target byte-for-byte to the same working generation rather than leaving config, component, and scene files partially reset.

Preview validates the pointer schema, revision syntax, derived publication path, embedded revision, exact scene set, ordered authority paths, and the SHA-256 of `authority.bin` before parsing or rendering anything. Fonts, images, manifests, and scenes are read from those verified bytes. A clean Chromium run rendered Menu under the exact revision with zero errors (`preview-integrity-clean.png`). Flipping one byte in `authority.bin` produced `Publication authority-byte digest does not match the revision stamp` and rendered zero scene children (`preview-integrity-tampered-rejected.png`). The byte was restored immediately after the probe.

## Frozen asset contract and semantic safety

Validation derives the editor-eligible asset set from MR1 `authoring/reference/assets.yaml`: current live UI assets except the favicon-only app icon, plus the live and loaded-fallback fonts. It compares the complete key, source, hash, dimensions, URL, and Phaser pack type against that frozen set. A negative test adds the imported-unused replay icon to both mutable project files, copies its exact bytes, and confirms validation still rejects it.

`Semantic.ts` is compared byte-for-byte with the canonical inert five-field carrier in both working and protected baseline locations. A negative test injects layout behavior and confirms validation rejects it.

The native-scene `duplicate` action clones a selected hierarchy and atomically assigns unique native `id`, `label`, and `Semantic.fabSemanticId` values to the root and every descendant before insertion. The integration test duplicates `menu.currency` as `menu.currency.bonus`, proves all four clone identities are unique and aligned, preserves semantic bindings, and validates the resulting 224-object native scene before restoring it.

## Real licensed-editor persistence proof

This pass made a non-no-op property edit in licensed Phaser Editor v5.0.2:

1. Opened `Win.scene`, selected `win.title`, changed native X from `0` to `12`, and invoked native `Meta+S`.
2. `Win.scene` changed from SHA-256 `6227a28b9403903103e62c1d1add8b464771efbd8a53764d7daa31abcd1738cd` to `ba65ee6f72732213814929d16e7398bc9c65c58562da41c58726ab3d2f458d3e` (`Win-native-changed-saved.png`).
3. Fully terminated the editor, observed port 19594 refuse connections, started a fresh licensed server, reopened `Win.scene`, reselected `win.title`, and observed X `12` with the changed hash intact (`Win-native-changed-after-restart.png`).
4. Fully terminated the editor again, ran the protected reset, and proved working and baseline `Win.scene` both returned to the original hash.
5. Started a third fresh editor server, reopened the reset scene, and observed native X `0` (`Win-native-reset-reopened.png`). No page or console errors occurred in any observation.

This is reversible native persistence evidence: a real editor-authored mutation survived save and full restart, then protected reset restored the exact baseline bytes and reopened value.

## Verification

- Native authoring tests: 17/17, including publication-source tamper, frozen-preimage tamper, concurrent-save publication capture, post-rename cleanup, atomic-pointer failure, transactional reset rollback, MR1 imported-unused asset injection, coordinated frozen-contract mutation, semantic hierarchy duplication, and injected Semantic behavior.
- Native validator: 9 scenes, 220 semantic objects, 16 exact eligible assets.
- Preview clean/tamper browser integration: PASS at the active revision.
- Licensed Phaser Editor v5.0.2 mutation/save/full-restart/reset/full-restart: PASS.
- Full repository gates are recorded in the card handoff after the final run.
