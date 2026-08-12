# FTB level editor legacy-file consumer matrix

Scope: production code under `levelbuilder/` and `ui/src/` at 2026-08-12. Search anchors included `dogs_dir`, `hitboxes.json`, `session.json`, `sprite_`, `variant_`, `load_session_raw`, `save_hitboxes`, `selected_bg`, `archived`, `level.json`, and manual `/ "dogs"` joins. A row is one function/component I/O boundary; repeated accesses inside the same boundary are represented once, while a function touching differently classified surfaces has multiple rows. `level.json` means the authoring-session copy unless the surface explicitly says public/export. Pure schemas, comments, tests, job-store fields whose names merely contain `sprite`/`variant`, and archive-ledger-only accesses are excluded.

| file:line | function | surface | read/write | classification |
|---|---|---|---|---|
| `levelbuilder/api/session.py:314` | `_sprite_metadata_path` | `dogs/<slot>/sprite_*.json` path resolver (with `variant_*.box.json` fallback) | read | canonical-runtime |
| `levelbuilder/api/session.py:318` | `_variant_box_path` | `dogs/<slot>/variant_*.box.json` path resolver | read | generation-input |
| `levelbuilder/api/session.py:437` | `_level_sprite_metadata` | session `level.json` sprite metadata, then active sprite sidecars | read | canonical-runtime |
| `levelbuilder/api/session.py:500` | `active_sprite_metadata_map` | session `level.json`; `dogs/<slot>/sprite_*.json` | read | canonical-runtime |
| `levelbuilder/api/session.py:518` | `require_all_painted_dogs_mapped` | `dogs/<slot>/variant_*.png` and active sprite metadata | read | generation-input |
| `levelbuilder/api/session.py:557` | `require_sprite_metadata_for_indices` | active `sprite_*.json` sidecars | read | generation-input |
| `levelbuilder/api/session.py:622` | `sprite_animation_candidates` | `dogs/<slot>/sprite_*.json`, `sprite_*.png`, masks | read | canonical-runtime |
| `levelbuilder/api/session.py:766` | `repair_cross_bird_padding` | sidecar geometry and session `level.json` sprite geometry | read/write | canonical-runtime |
| `levelbuilder/api/session.py:856` | `sprite_animation_candidate_by_id` | candidate list derived from sidecars | read | canonical-runtime |
| `levelbuilder/api/session.py:863` | `set_sprite_human_confirmation` | candidate `sprite_*.json` confirmation | read/write | canonical-runtime |
| `levelbuilder/api/session.py:923` | `_current_hitbox_snapshot` | `hitboxes.json`, fallback session/public `level.json` dogs | read | canonical-runtime |
| `levelbuilder/api/session.py:959` | `get_hitbox_review_status` | current hitbox snapshot | read | canonical-runtime |
| `levelbuilder/api/session.py:1032` | `set_level_golden_review` | session `level.json`, sprite PNGs and sidecars | read/write | export-evaluation |
| `levelbuilder/api/session.py:1126` | `get_final_cutout_review_status` | session `level.json`, sprite PNGs and sidecars | read | canonical-runtime |
| `levelbuilder/api/session.py:1194` | `get_final_cutout_review_readiness` | session `level.json`, sprite PNGs and sidecars | read | canonical-runtime |
| `levelbuilder/api/session.py:1242` | `require_ready_sprite_animation_candidate` | sidecar-derived candidate and sprite PNG | read | generation-input |
| `levelbuilder/api/session.py:1531` | `session_dir` / `hitbox_geometry` | session/public `level.json` dogs and review-bound `hitboxes.json` | read | canonical-runtime |
| `levelbuilder/api/session.py:2077` | `project_canonical_bird_compatibility` | snapshot assets projected to `sprite_*.png`, masks, sidecars | write | export-evaluation |
| `levelbuilder/api/session.py:2153` | `clone_session` | whole legacy session tree, `session.json`, session `level.json` | read/write | legacy-authoring |
| `levelbuilder/api/session.py:2225` | `save_session` | `session.json` | write | legacy-authoring |
| `levelbuilder/api/session.py:2246` | `load_session_raw` | `session.json` | read | legacy-authoring |
| `levelbuilder/api/session.py:2434` | `list_sessions` | `session.json`, `hitboxes.json`, session `level.json`, sidecar confirmation glob | read | canonical-runtime |
| `levelbuilder/api/session.py:2674` | `ensure_session_json` | public/session `level.json`; creates `session.json`, `hitboxes.json`, `variant_*.png` | read/write | migration-import |
| `levelbuilder/api/session.py:2941` | `hydrate_session` | `session.json` dogs/selected_bg, `hitboxes.json`, variants and sidecars | read | canonical-runtime |
| `levelbuilder/api/session.py:3129` | `create_session` | initializes `session.json` dogs/selected_bg/archive fields | write | legacy-authoring |
| `levelbuilder/api/session.py:3216` | `update_session_field` | arbitrary `session.json` field | read/write | legacy-authoring |
| `levelbuilder/api/session.py:3226` | `record_generated_background` | `session.json` background records/selection state | read/write | legacy-authoring |
| `levelbuilder/api/session.py:3267` | `merge_background_records` | `session.json` background records | read/write | legacy-authoring |
| `levelbuilder/api/session.py:3291` | `has_downstream_artifacts` | `hitboxes.json`, session `level.json`, `dogs/*/variant_*.png` | read | legacy-authoring |
| `levelbuilder/api/session.py:3306` | `select_background` | `session.json.selected_bg` | read/write | canonical-runtime |
| `levelbuilder/api/session.py:3346` | `build_level_dict` | active sprite/variant metadata assembled into session `level.json` shape | read | export-evaluation |
| `levelbuilder/api/session.py:3552` | `synthesise_level_json` | `hitboxes.json`, sprite/variant metadata; session `level.json` | read/write | export-evaluation |
| `levelbuilder/api/session.py:3615` | `_load_hitboxes_raw` | `hitboxes.json` | read | legacy-authoring |
| `levelbuilder/api/session.py:3638` | `clone_session_for_comparison` | `session.json`, session `level.json`, `hitboxes.json` through clone | read/write | export-evaluation |
| `levelbuilder/api/session.py:3669` | `recenter_hitboxes_to_sprites` | `session.json` dogs, sprite metadata, `hitboxes.json` | read/write | canonical-runtime |
| `levelbuilder/api/session.py:3781` | `reconcile_magenta_hitboxes_to_detections` | `session.json` dogs, `hitboxes.json`, session `level.json` | read/write | canonical-runtime |
| `levelbuilder/api/session.py:3948` | `materialize_detection_sprites` | `session.json`, `hitboxes.json`; writes variants, sprite PNG/mask/sidecar | read/write | generation-input |
| `levelbuilder/api/session.py:4263` | `sync_active_sprite_set_to_levels` | sprite PNG/mask/sidecar copied to public dogs; session/public `level.json` | read/write | export-evaluation |
| `levelbuilder/api/session.py:4310` | `sync_sprite_metadata_to_levels` | active sidecars; session/public `level.json` | read/write | export-evaluation |
| `levelbuilder/api/session.py:4366` | `finalize_one_shot_from_detections` | `session.json.selected_bg`; writes hitboxes and session `level.json` | read/write | canonical-runtime |
| `levelbuilder/api/session.py:4431` | `save_hitboxes` | `session.json` dogs; `hitboxes.json` | read/write | canonical-runtime |
| `levelbuilder/api/session.py:4550` | `get_next_variant_index` | `dogs/<slot>/variant_*.png` names | read | generation-input |
| `levelbuilder/api/session.py:4591` | `_new_dog_meta` | creates `session.json dogs[]` entry | write | legacy-authoring |
| `levelbuilder/api/session.py:4626` | `resolve_dog_index_by_id` | `session.json dogs[]` | read | canonical-runtime |
| `levelbuilder/api/session.py:4644` | `delete_dog_by_id` | `session.json dogs[]`, `hitboxes.json`, dogs folder tombstone | read/write | canonical-runtime |
| `levelbuilder/api/session.py:4727` | `set_active_variant` | `session.json dogs[].active_variant` | read/write | generation-input |
| `levelbuilder/api/session.py:4742` | `update_dog_status` | `session.json dogs[]` | read/write | generation-input |
| `levelbuilder/api/session.py:5005` | `export_to_game` | all legacy authoring surfaces; emits public `level.json` and sprite assets | read/write | export-evaluation |
| `levelbuilder/api/session.py:6056` | `clear_incomplete_sessions` | presence of `session.json`, `hitboxes.json`, exported `level.json` | read | legacy-authoring |
| `levelbuilder/api/session.py:6103` | `set_archived` | `session.json.archived` / `archived_variants` | read/write | legacy-authoring |
| `levelbuilder/api/routes.py:1172` | `sprite_candidate_asset` | sidecar-derived `sprite_*.png`/mask path | read | canonical-runtime |
| `levelbuilder/api/routes.py:1207` | `_render_sprite_candidate_overlay` | `sprite_*.json`, `sprite_*.png`, scene image | read | canonical-runtime |
| `levelbuilder/api/routes.py:1282` | `sprite_candidate_overlay` | candidate lookup and overlay legacy assets | read | canonical-runtime |
| `levelbuilder/api/routes.py:1315` | `auto_place_sprite_candidates` | sidecar-derived candidates | read | canonical-runtime |
| `levelbuilder/api/routes.py:1385` | `save_sprite_candidate_placement` | candidate sidecar and session/public `level.json` placement | read/write | canonical-runtime |
| `levelbuilder/api/routes.py:1481` | `save_sprite_candidate_human_confirmation` | sidecar confirmation via candidate lookup | read/write | canonical-runtime |
| `levelbuilder/api/routes.py:1714` | `select_background` | `session.json.selected_bg` | read/write | canonical-runtime |
| `levelbuilder/api/routes.py:1929` | `start_upscale_background_job` | `session.json.selected_bg` | read | generation-input |
| `levelbuilder/api/routes.py:2068` | `_upscale_background_sync` | `session.json.selected_bg` | read | generation-input |
| `levelbuilder/api/routes.py:2245` | `save_hitboxes` | `hitboxes.json` through session service | write | canonical-runtime |
| `levelbuilder/api/routes.py:2285` | `_visibility_check_for_session` | `session.json.selected_bg`, `hitboxes.json` | read | generation-input |
| `levelbuilder/api/routes.py:2441` | `auto_place_hitboxes` | `session.json.selected_bg`, writes `hitboxes.json` | read/write | canonical-runtime |
| `levelbuilder/api/routes.py:2588` | `set_active_variant_by_id` | `session.json dogs[].active_variant` | write | generation-input |
| `levelbuilder/api/routes.py:2708` | `get_sprite_gaps` | `session.json dogs[]`, `hitboxes.json`, active variant/sidecar metadata | read | canonical-runtime |
| `levelbuilder/api/routes.py:2775` | `pickup_preview` | `session.json.selected_bg`, `hitboxes.json`, session/public `level.json` | read | export-evaluation |
| `levelbuilder/api/routes.py:2910` | `sprites_preview` | session/public `level.json` sprite assets | read | export-evaluation |
| `levelbuilder/api/routes.py:2996` | `finalize_magenta_hitboxes` | `hitboxes.json` | read/write | canonical-runtime |
| `levelbuilder/api/routes.py:3043` | `materialize_detection_sprites` | sprite/variant authoring assets via service | write | generation-input |
| `levelbuilder/api/routes.py:3386` | `_bundle_projection` | exported/public `level.json` existence and metadata | read | export-evaluation |
| `levelbuilder/api/routes.py:3573` | `set_archived` | `session.json` archive fields | read/write | legacy-authoring |
| `levelbuilder/api/inpaint.py:248` | `_resolve_selected_bg` | `session.json.selected_bg` | read | generation-input |
| `levelbuilder/api/inpaint.py:1835` | `_save_sprite_assets` | writes `sprite_*.png`, masks, `sprite_*.json` | write | generation-input |
| `levelbuilder/api/inpaint.py:2009` | `_save_pending_sprite_metadata` | pending `sprite_*.json` | write | generation-input |
| `levelbuilder/api/inpaint.py:2042` | `_save_variant_box` / `_load_variant_box` | `variant_*.box.json` | read/write | generation-input |
| `levelbuilder/api/inpaint.py:2713` | `_validate_crop_inpaint_inputs` | `session.json dogs[]/selected_bg`; request hitboxes | read | generation-input |
| `levelbuilder/api/inpaint.py:2818` | `_start_crop_inpaint_job_record` | `session.json dogs[]/selected_bg`, persisted hitboxes | read | generation-input |
| `levelbuilder/api/inpaint.py:3048` | `_run_crop_inpaint_job` | `session.json dogs[]/selected_bg`; variants, sidecars, sprites; session `level.json` refresh | read/write | generation-input |
| `levelbuilder/api/inpaint.py:3661` | `_run_magenta_inpaint_job` | `session.json`, `hitboxes.json` | read | generation-input |
| `levelbuilder/api/inpaint.py:3916` | `_run_single_dog_regen` | `session.json dogs[]/selected_bg`; variant and sprite assets | read/write | generation-input |
| `levelbuilder/api/inpaint.py:4185` | `_load_retry_hitboxes` | `hitboxes.json`, fallback session/public `level.json` dogs | read | generation-input |
| `levelbuilder/api/inpaint.py:4207` | `_normalized_retry_dog_indices` | `session.json dogs[]` | read | generation-input |
| `levelbuilder/api/inpaint.py:4472` | `_auto_place_cutout_best_safe` | sprite sidecars/PNGs and neighboring sidecars | read/write | generation-input |
| `levelbuilder/api/inpaint.py:4595` | `_run_single_cutout_extraction` | variant PNG/box; writes sprite PNG/mask/sidecar | read/write | generation-input |
| `levelbuilder/api/inpaint.py:4776` | `_run_retry_failed_dogs_job` | hitbox/level input, variants, sprite assets, projection | read/write | generation-input |
| `levelbuilder/api/inpaint.py:5080` | `_paste_pickup_sprite` | active sprite PNG/sidecar, fallback variant PNG | read | generation-input |
| `levelbuilder/api/inpaint.py:5122` | `compose_with_mask` | `session.json.selected_bg`; active variants/sprites | read | generation-input |
| `levelbuilder/api/inpaint.py:5291` | `recomposite_color` | `session.json.selected_bg`, `hitboxes.json`, sprite assets, session/public `level.json` | read/write | generation-input |
| `levelbuilder/api/inpaint.py:5810` | `recenter_hitboxes_local_diff` | `session.json.selected_bg`, `hitboxes.json`, sprite sidecars/PNGs | read/write | canonical-runtime |
| `levelbuilder/api/inpaint.py:6026` | `run_magenta_inpaint` | `session.json.selected_bg`, session/public `level.json` | read/write | generation-input |
| `levelbuilder/api/inpaint.py:6142` | `compare_inpaint` | `session.json.selected_bg`, `hitboxes.json` | read | export-evaluation |
| `levelbuilder/api/inpaint.py:6220` | `inpaint_magenta` | `session.json.selected_bg`, request/persisted hitboxes | read/write | generation-input |
| `levelbuilder/api/canonical_migration.py:183` | `live_dog_folders` / `tombstone_dog_folders` | `dogs/<slot>/` directories | read | migration-import |
| `levelbuilder/api/canonical_migration.py:218` | `read_hitboxes` | `hitboxes.json` | read | migration-import |
| `levelbuilder/api/canonical_migration.py:226` | `read_session_json` | `session.json` | read | migration-import |
| `levelbuilder/api/canonical_migration.py:234` | `active_variant_index` / `variant_indices` / `read_variant_box` | variant names and `variant_*.box.json` | read | migration-import |
| `levelbuilder/api/canonical_migration.py:280` | `load_dog_folder_variant` | `variant_*.png` and box | read | migration-import |
| `levelbuilder/api/canonical_migration.py:516` | `selected_background_path` | `session.json.selected_bg` | read | migration-import |
| `levelbuilder/api/canonical_migration.py:534` | `read_level_json` | session/public `level.json` | read | migration-import |
| `levelbuilder/api/canonical_migration.py:561` | `read_sprite_metadata` | `sprite_*.json`, PNG/mask | read | migration-import |
| `levelbuilder/api/canonical_migration.py:625` | `build_canonical_projection` | every legacy authoring surface | read | migration-import |
| `levelbuilder/api/canonical_migration.py:1093` | `build_public_level_projection` | public `level.json`, sprites, variants | read | migration-import |
| `levelbuilder/api/corpus_migration.py:68` | `restore_verified_legacy_hitbox_review` | `hitboxes.json` | read/write | migration-import |
| `levelbuilder/api/corpus_migration.py:145` | `restore_verified_legacy_final_cutout_review` | session `level.json`, sprite assets/sidecars | read/write | migration-import |
| `levelbuilder/api/corpus_migration.py:233` | `propose_cleanup_identity_repair` | `session.json dogs[]`, `hitboxes.json`, sprite sidecars | read | migration-import |
| `levelbuilder/api/corpus_migration.py:363` | `repair_cleanup_identity_bindings` | `session.json`, session `level.json`, sprite sidecars | read/write | migration-import |
| `levelbuilder/api/corpus_migration.py:666` | `plan_legacy_level` | all legacy authoring surfaces | read | migration-import |
| `levelbuilder/api/corpus_migration.py:942` | `import_authoring_from_public` | public `level.json`/sprites; writes session, hitboxes, sprite sidecars | read/write | migration-import |
| `levelbuilder/api/backfill_stable_ids.py:169` | `stamp_session` | `session.json dogs[]`, `hitboxes.json` | read/write | migration-import |
| `levelbuilder/api/sprite_eval.py:765` | `evaluate_level_dir` | `level.json`, sprite PNG, `sprite_*.json` source box | read | export-evaluation |
| `levelbuilder/api/sprite_eval.py:1025` | `apply_match_report` | `level.json` and matching sprite sidecars | read/write | export-evaluation |
| `levelbuilder/golden_cutouts.py:546` | `_load_placement_samples` | `level.json`, sprite PNG and sidecar | read | export-evaluation |
| `levelbuilder/cli/main.py:333` | `cmd_doctor` | session folder missing `session.json` | read | legacy-authoring |
| `levelbuilder/cli/main.py:1171` | `cmd_review` | writes review fixture `session.json` | write | export-evaluation |
| `levelbuilder/cli/main.py:1383` | `cmd_align_sprites` | `level.json`, sprite sidecars; mirrors sidecars to authoring tree | read/write | export-evaluation |
| `ui/src/App.tsx:145` | `applySession` / active-session derivation | API `dogs[]` and `selectedBgIndex` derived from legacy session | read | canonical-runtime |
| `ui/src/api/useInpaintStream.ts:87` | `updateDog` / stream reconciliation | API `dogs[]` derived from `session.json` | read/write | generation-input |
| `ui/src/components/StepBackgrounds.tsx:107` | `handleSelect` / upscale effect | API `selectedBgIndex` derived from `session.json.selected_bg` | read/write | canonical-runtime |
| `ui/src/components/StepInpaint.tsx:85` | `updateDogsForMutation` / retry flow | API `dogs[]` and selected background | read/write | generation-input |
| `ui/src/components/DogsCanvas.tsx:158` | dog delete/variant callbacks and editor state | API `dogs[]`, `selectedBgIndex` | read/write | canonical-runtime |
| `ui/src/components/LevelCanvas.tsx:338` | `LevelCanvas` | hydrated `dogs[]`, selected background and hitboxes | read | canonical-runtime |
| `ui/src/components/DogStrip.tsx:69` | `DogStrip` | hydrated `dogs[]` order/status/variants | read | canonical-runtime |
| `ui/src/components/GalleryPage.tsx:69` | `isCardArchived` / `handleArchivedChanged` | API `archived`, `archivedVariants` derived from `session.json` | read/write | legacy-authoring |
| `ui/src/components/GalleryReviewModal.tsx:143` | `applySession` and review editor | hydrated `dogs[]`, `selectedBgIndex`, archive state | read/write | canonical-runtime |

Classification counts (rows, not individual filesystem operations): **canonical-runtime 39; generation-input 34; legacy-authoring 15; migration-import 18; export-evaluation 17; total 123**.

The five conversion sites with the widest blast radius are:

1. `levelbuilder/api/session.py:2941 hydrate_session` — supplies the main editor state consumed across `App`, canvases, wizard steps, gallery review, and stream reconciliation.
2. `levelbuilder/api/session.py:622 sprite_animation_candidates` — shared by candidate list, lookup, overlay, placement, confirmation, readiness, and animation generation.
3. `levelbuilder/api/session.py:4431 save_hitboxes` — central write seam for direct saves, auto-placement, detection finalization, recentering, dog deletion, and generation setup.
4. `levelbuilder/api/inpaint.py:3048 _run_crop_inpaint_job` — paid generation lane that binds session dogs/background/hitboxes to variants, sprites, sidecars, and level refresh.
5. `levelbuilder/api/session.py:5005 export_to_game` — terminal aggregation boundary reading every compatibility surface and producing the shipped package; it may retain compat output but must consume canonical state safely.
