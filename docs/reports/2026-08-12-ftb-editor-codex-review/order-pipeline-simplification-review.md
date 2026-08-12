I’m using the code-review workflow because this is an architecture/regression review. I’ll inspect the exact authority and publish paths, then return only the requested Markdown to stdout.

The review workflow requires independent parallel reviewers for a high-risk silent-publish failure, so I’m dispatching two bounded code-reading passes while I trace the full pipeline locally. No files will be changed.

The trace confirms the failure is structural: `createManifestClient.initialize()` accepts any valid CDN manifest without comparing revisions, while `resolveRuntimeSequence()` then treats that manifest’s array order as the default. The editor’s Start path does not publish that CDN artifact at all; it mutates the bundle projection and then attempts Remote Config.

# Find The Bird level-order / publish simplification

## 1. Minimal-authority redesign

Use one canonical artifact:

`games/find_the_bird/public/levels/manifest.json`

It must contain:

```json
{
  "version": 2,
  "releaseRevision": 1453,
  "artifactDigest": "<sha256-of-canonical-json>",
  "generatedAt": "...",
  "levels": [
    {
      "id": "level-id",
      "bundled": true,
      "assets": {},
      "package": {}
    }
  ]
}
```

The `levels` array is the sole progression order. `bundled` controls native asset inclusion, not order.

One publisher owns it:

1. Read `sequence-workflow.json#draft.levelIds`.
2. Validate every level.
3. Calculate the native bundle projection.
4. Allocate one monotonic `releaseRevision`.
5. Serialize the canonical manifest exactly once.
6. Stage/upload assets.
7. Upload the manifest last.
8. Read back and verify its revision and digest.
9. Install those exact manifest bytes in the app source tree.
10. Only then update the editor’s live-state mirror.

Change `tools/level-editor/levelbuilder/api/routes.py::_run_sequence_start_job` to execute this complete transaction. It currently applies `_apply_sequence_bundle_projection()` and then publishes an unrelated Remote Config payload; it never updates R2.

Change `games/find_the_bird/build/nativePublicBundle.ts::copyNativePublicBundle` to:

- Copy the full canonical manifest unchanged.
- Preserve its full ordered `levels` array.
- Copy assets only for entries with `bundled: true`.
- Stop rewriting order or manufacturing a separate native manifest.

Delete or derive these authorities:

| Current artifact/authority | Disposition |
|---|---|
| Sequence workflow draft | Keep as editable draft only; it is not live until Start succeeds. |
| `public/levels/manifest.json` | New sole published authority. |
| `bundled-manifest.json` | Temporarily derive by filtering `bundled: true`; then delete. |
| `levels-index.json` | Derive IDs/names during compatibility; then delete. |
| R2 `manifest.json` | Exact bytes of canonical manifest, not independently generated. |
| RC `levelSequencePayload` | Delete. |
| `storedSequence` localStorage cache | Delete and clear once during migration. |
| `catalog-manifest.json` | Keep editor-only as unordered inventory, or fold runtime fields into the canonical manifest and delete it from runtime. |
| Catalog snapshots | Delete after RC-pinned sequence rollback is removed. |

Convert `tools/level-editor/scripts/publish_ftb_cdn.py` into a thin wrapper around the same publisher, with no independent `--order-file`, revision allocation, or manifest generation. Prefer deleting it once Start has equivalent CLI automation.

Remove `reconcileManifestBundledAuthority()` and `manifestWithBundledFallbackEntries()` from `games/find_the_bird/src/data/levels.ts`. They exist only to reconcile two authorities and can append missing bundled IDs to the CDN order.

Rollback must publish a new, higher `releaseRevision` containing an older desired order. Never roll the revision counter backward.

## 2. Immediate staleness defense

The exact failure is in `games/find_the_bird/src/v1core/assets.ts::createManifestClient.initialize()`: any structurally valid CDN manifest replaces the bundled fallback without a revision comparison.

Make this immediate change:

```ts
if (
  validManifest(parsed) &&
  parsed.manifestRevision >= bundledFallback.manifestRevision
) {
  manifest = parsed;
  usedFallback = false;
} else {
  manifest = bundledFallback;
  usedFallback = true;
}
```

Also strengthen `validManifest()` to require:

```ts
Number.isSafeInteger(manifest.manifestRevision) &&
manifest.manifestRevision >= 0
```

When CDN revision is lower:

- Refuse it.
- Use the bundled manifest.
- Emit a visible diagnostic containing both revisions.
- Set `usedFallback = true` so a later initialization can retry.

Do not compare `generatedAt`; clocks are not an authority.

The final ManifestV2 rule should be:

- CDN revision lower than bundled: refuse.
- CDN revision higher: accept.
- Equal revision and equal `artifactDigest`: accept because artifacts are identical.
- Equal revision and different digest: refuse as corruption/split-brain publication.

Required unit cases:

- Lower CDN revision cannot change runtime order.
- Missing or invalid revision falls back.
- Higher revision wins.
- Equal revision and matching digest succeeds.
- Equal revision and different digest fails closed.

## 3. Bundle-projection budget bug

`tools/level-editor/levelbuilder/api/routes.py::_bundle_projection()` uses `_directory_size(public/levels/<id>)`. That counts authoring PNGs and unrelated files the native packer never ships.

Replace directory size with the actual unique files referenced by:

```py
PublicLevels.public_level_manifest_entry(
    S.GAME_PUBLIC_LEVELS,
    level_id,
)
```

Recursively collect every asset `path` from that entry, matching `nativePublicBundle.ts::collectManifestPaths()`, and sum actual `Path.stat().st_size` values. Maintain a projection-wide `seen_paths` set so shared assets are charged once.

This includes whichever referenced fields are present:

- `levelJson`
- `colorImage`
- `bgImages`
- `dogSprites`
- `thumbnailImage`
- `styleVariants`

Do not trust directory size. Prefer actual file sizes over manifest-declared sizes because the cap applies to bytes packed.

The 200 MB limit covers the whole native public output, not merely level packages. Therefore either:

- Subtract the measured fixed non-level bundle and manifest overhead before projecting levels; or
- Run a dry-run pack using the same packer and measure its output.

Keep `nativePublicBundle.ts`’s final `directorySize(outputRoot)` cap as the hard enforcement gate.

Remove the duplicated numeric policy between:

- `routes.py::_BUNDLE_CAP_BYTES`
- `nativePublicBundle.ts::NATIVE_WEB_BUNDLE_MAX_BYTES`

Put the value in one shared configuration file consumed by both languages, or make the backend call the packer’s estimator. Add a regression fixture containing large unused PNGs and small referenced WebPs; the PNGs must not move the boundary.

## 4. Independently shippable migration

1. **Refuse stale CDN manifests.**  
   Patch `createManifestClient.initialize()` and add revision tests. No publisher change is required.

2. **Correct bundle projection.**  
   Replace `_directory_size()` with unique referenced-asset bytes. Retain the packer’s final 200 MB enforcement.

3. **Unify the existing transaction.**  
   Make Sequence Start publish the CDN assets and manifest, verify R2 readback, and update editor live state only after success. Temporarily continue producing all legacy files.

4. **Introduce canonical ManifestV2.**  
   Start generates it once. Derive `bundled-manifest.json` and `levels-index.json` from it for old consumers. Assert matching revision/order in CI.

5. **Remove the second publisher.**  
   Convert `publish_ftb_cdn.py` to a wrapper around Start or delete it. It must no longer accept an independent order or allocate revisions.

6. **Switch the native packer.**  
   Package the complete canonical manifest unchanged and only the assets marked `bundled`. Verify packed size against the projection.

7. **Switch runtime to manifest-only order.**  
   `defaultLevelIds(manifest)` becomes the only resolver. Clear `ftd_active_level_sequence_v1` once during upgrade.

8. **Remove RC sequence activation.**  
   Delete the Remote Config publisher requirement from Start and replace rollback with a newer manifest publication.

9. **Delete compatibility artifacts and reconciliation.**  
   Remove `bundled-manifest.json`, `levels-index.json`, their endpoints/helpers, and `reconcileManifestBundledAuthority()`.

10. **Remove runtime catalog machinery.**  
    Fold package/cache metadata into ManifestV2, then remove runtime catalog fetching and snapshots. Keep a separate editor inventory only if authoring needs all 101 catalog entries.

Each release must be checked on a physical device in both online and offline modes. The observed level order must match the canonical manifest in both cases.

## 5. Dead or vestigial code after redesign

Delete from `games/find_the_bird/src/sequence/runtimeSequence.ts`:

- `RUNTIME_SEQUENCE_STORAGE_KEY`
- `StoredRuntimeSequence`
- `RuntimeSequenceSource` variants `remote` and `cached`
- `payloadFromStoredSequence()`
- `storedSequenceFromPayload()`
- `validateStoredSequence()`
- `hasRemoteSequencePayload()`
- `isExplicitRemoteDisable()`
- RC validation and cached fallback branches in `resolveRuntimeSequence()`
- `parseStoredRuntimeSequence()`
- `serializeStoredRuntimeSequence()`

Reduce `resolveRuntimeSequence()` to deriving playable IDs from the canonical manifest, or delete the abstraction and use `defaultLevelIds()` directly.

Delete from `games/find_the_bird/src/data/levels.ts`:

- `readStoredRuntimeSequence()`
- `writeStoredRuntimeSequence()`
- `remotePayloadCatalogRevision()`
- `isExplicitRemoteSequenceDisable()`
- RC-dependent branches in `resolveActiveRuntimeSequence()`
- `catalogManifestForSequenceRevision()`
- Catalog snapshot retry/fetch state used for RC rollback
- `reconcileManifestBundledAuthority()`
- `manifestWithBundledFallbackEntries()`

Delete from `games/find_the_bird/src/v1core/assets.ts`:

- `ManifestClient.hasNewerRevisionThanLastSeen()`
- `ManifestClient.markCurrentRevisionSeen()`

They are already no-ops.

Delete from `tools/level-editor/levelbuilder/api/routes.py` and session helpers:

- `GET /levels-index`
- `PUT /levels-index`
- Direct bundled-manifest order mutation
- `_apply_sequence_bundle_projection()` as a standalone mutation; projection becomes an input to canonical publication
- `S.reorder_levels_index()` and synchronization writes
- Remote Config publisher setup in `_publisher_for_sequence_write()`
- `SequenceActivation.activate_sequence_draft()` from the Start path

Delete from `publish_ftb_cdn.py`:

- Independent revision calculation
- Independent manifest construction
- `--order-file`
- Direct `levels-index.json` rewrite
- Any ability to publish outside the canonical Start transaction

`catalog-manifest.json` must never provide progression order. If retained for editor discovery, make it explicitly unordered/keyed by ID and stop bundling or fetching it in the game.

Two independent reviewers were used for the authority trace and migration-risk pass. No repository files were modified.

