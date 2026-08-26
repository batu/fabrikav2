---
name: provision-game-services
description: Provision or adopt per-game records in GameAnalytics, Firebase, RevenueCat, Adjust, and AdMob, then materialize their runtime configuration without exposing credentials. Use when setting up analytics, attribution, commerce, ads, or Firebase for a game; creating a platform-specific provider record; repairing stale or missing game-service environment values; or preparing provider configuration before a native release.
---

# Provision Game Services

Establish exact provider identities first, mutate only with authority, and keep
credential values outside Git and command output. Treat provider setup and
release verification as separate workflows.

## Establish the contract

1. Read the game environment example, validator, runtime provider selection,
   bundle/package authority, and native resource recipe.
2. Record the game, platform, production bundle/package ID, provider account,
   required runtime fields, and authorized external actions.
3. Search for existing provider records by exact platform and bundle/package
   identity before creating anything. A similarly named game is not a match.
4. Classify each provider action as `reuse`, `create`, `update`, `unsupported`,
   or `blocked`. Discovery is read-only: do not write Keychain entries, local
   environment files, or provider settings during discovery.
5. Read [references/provider-contracts.md](references/provider-contracts.md)
   for provider-specific identity and credential boundaries.

## Provision safely

1. Prefer an official API or CLI with the narrowest required scope.
2. Use an already-authenticated browser only when the official automation
   surface is unavailable. Keep one provider/account/environment browser
   profile, require exact account readback, and never infer success from a
   click or navigation.
3. Before mutation, read back the exact provider object identity and relevant
   precondition/version. If it changed after approval, stop and rediscover.
4. After creation, read the new object back by provider ID and verify its name,
   platform, bundle/package ID, and parent account before retrieving credentials
   or configuring child objects.
5. On partial failure after creation, preserve the provider object ID and
   idempotency evidence. Never adopt a newly appeared object merely because its
   natural identity matches.

External account creation, provider object creation, credential rotation, and
production configuration changes are mutations. Require explicit authorization
unless the current request already authorizes that exact action.

## Materialize credentials

1. Prefer stable Keychain or protected-file references when the repository has
   a materializer. Otherwise use the narrow deterministic helper in this skill.
2. Put iOS values in the repository's authoritative mode-local file (normally
   `.env.ios.local`), not whichever `.env` filename is most convenient.
3. Keep input credential files and the destination owner-only (`0600`), regular,
   and non-symlinked. Never pass credential values in argv, shell history, logs,
   patches, receipts, screenshots, or chat.
4. Write updates atomically and preserve unrelated entries:

   ```bash
   uv run .codex/skills/provision-game-services/scripts/materialize_env.py \
     --target games/<game>/.env.ios.local \
     --updates-file /absolute/protected/updates.json
   ```

   The protected JSON file must be an object of environment key/value strings.
   The helper reports only updated key names and permission state.
5. Remove transient plaintext capture files after successful materialization.
   Do not remove stable owner-controlled credential sources.

## Prove the result

1. Compare local credential hashes with hashes computed from provider readback;
   never print either plaintext value.
2. For Firebase, compare environment values with the authoritative
   `GoogleService-Info.plist` or `google-services.json` field by field and verify
   the native bundle/package identity.
3. Run the game-owned environment validator from the correct checkout. Resolve
   the validator path explicitly; a green validator from a sibling worktree is
   evidence for the sibling worktree, which is an unusually elaborate form of
   nothing.
4. Confirm the destination is ignored by Git, mode `0600`, and absent from
   `git status` and staged diffs.
5. Report provider discovery, provider mutation, local materialization, SDK
   handoff, provider ingestion, build, install, launch, and gameplay evidence as
   separate states. Load `portal-game-release` for release approval/publication
   and `game-device-verification` for physical-device proof.

## Never do these

- Do not create one shared OAuth/cloud project per game when the game only needs
  a per-game app or provider record under an existing automation project.
- Do not treat an Android provider record as the iOS record for the same title.
- Do not copy credentials from terminal output or embed them in `apply_patch`.
- Do not call SDK initialization success provider-dashboard ingestion.
- Do not turn a dashboard transport detail into a separate skill. API, CLI, and
  browser fallback are implementations of the same provisioning outcome.
