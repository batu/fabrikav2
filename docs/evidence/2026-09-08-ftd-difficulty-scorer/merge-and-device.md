# Commit, merge and device verification

User request: commit this work, merge it to main, and build on the iPhone.

Scope: the server-free difficulty CLI and its tests/documentation, frozen pilot,
Astra ranking evidence, the approved 54-level progression and matching editor
index. Existing artwork, placements, approvals and Bird changes are excluded.

- [x] Isolate owned changes from the dirty shared checkout, based on remote main.
- [x] Run 63 scorer/CLI tests, Ruff, the real offline 10-level pilot, and the
  exhaustive progression optimizer. The pilot planned 30 calls and made zero.
- [x] Independent final input/spending review: no blockers; all 38 scorer tests
  passed separately. No paid provider calls were made.
- [ ] Commit and push the owned changes; open and merge the reviewed PR after CI.
- [ ] Build the merged source with CDN enabled and the dedicated Dog Firebase
  configuration, preserving existing ad/revenue native patches.
- [ ] Install and launch on the free physical iPhone without deleting save data;
  inspect actual gameplay and record the exact build identity.

The prior CDN publication is already live as revision 11; see
`full-catalog/cdn-publish-receipt.json`. That publication is separate from Git
and from the device build. The other `ftd-ads-lifecycle` task was still driving
the iPhone at this turn's preflight; no competing device operation is authorized
by simply waiting for a process gap.

The isolated device environment was recovered from the verified submission
build's canonical values, validated by `tools/game-env`, and stored only in
ignored/protected local files. CDN is enabled and Firebase project is
`find-the-dog-basegamelab`. The test harness is enabled without an automatic
tour; no credentials or private environment files belong in this commit.
