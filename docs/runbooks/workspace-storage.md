# Scoped worktrees and native output

Use the installed Agency CLI for task isolation. Choose `bird`, `dog`, or
`find-games`; `full` is an explicit integration exception. Profiles include
shared packages, shell-template fixtures, required tooling and governing docs.
They exclude historical `docs/evidence` and unrelated game payloads. Bird and
Dog each include the other game's small public `config` directory because the
shared environment policy and identity tests compare both AdMob identities.
This includes no other game's assets, levels or dependencies.

```sh
agency workspace create --repo "$PWD" --path "$PWD/.worktrees/bird-task" \
  --branch feat/bird-task --base origin/main --profile bird
```

Existing worktrees are not bulk-converted. An active or dirty checkout must not
be shrunk. The Wayfinder driver uses this same creation/reuse boundary and emits
cleanup reviews for closed tickets; it no longer force-removes their worktrees.

For a Bird task, run checks explicitly in `@fabrikav2/find_the_bird`: typecheck,
test:unit, and the required build mode. Workspace-wide `--if-present` is not
proof that the selected game was checked. The existing `gen:level-types:check`
is a cross-game editor/Dog gate and requires `find-games`; it does not validate
Bird's distinct generated types. Do not fetch Dog assets as an implicit fallback
in a Bird-only checkout. Root postinstall patchers remain included by sparse
checkout's ancestor-file semantics.

Native-shell install, verify-device iOS builds, game-release iOS builds and
Mage Master install scripts use the shared native-shell output resolver.
Agency allocates a unique directory under `~/.local/share/agency/build-outputs`,
prints its location, and records source SHA, lane, owner and result in
`.agency-output.json`. Install consumes the exact returned App.app path.
Signed Release output is durable, protecting existing release/rollback refs;
release candidate staging and `local_app_ref` remain unchanged.

Debug output is scratch. Keep at least seven days and the latest two successful
attempts per repository/lane; failed builds are pinned for investigation.
These settings in `agents/config.json` generate review candidates only.
Generated Capacitor projects, web dist, node_modules, and Gradle plugin
intermediates remain owned by their source checkout. Use separate worktrees
for concurrent web/native preparation; the shared runner rejects overlapping
managed native builds in the same checkout. Never symlink mutable dependencies.

```sh
agency workspace outputs-review --repo "$PWD" --path /absolute/attempt-1 --path /absolute/attempt-2
agency workspace cleanup-review --repo "$PWD" --path /absolute/finished-worktree --check-pr
```

Include every attempt in the relevant lane when reviewing retention. Inspect
release references and local-only content before approving an exact removal.
No age-based deletion, branch deletion, cache purge, or production release is
authorized by these commands. Older output without metadata is retained.
