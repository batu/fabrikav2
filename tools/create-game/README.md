# tools/create-game

The scaffold generator. Running it stamps out a new `games/<name>/` workspace by
copying `games/_template` and substituting the name — gameplay `src/`, a
`game.config.ts` declaring the screens/saga/economy/ads/catalog/analytics the
shell will consume, and a default `design/` sheet — so creating a game (with its
own color scheme and assets) is a sheet-editing session, not a code session. This
replaces v1's "manually copy a sibling game" practice; theming-at-creation sits
on the time-to-ship critical path. See `docs/architecture/v2-architecture.md`
§design-sheets wiring.

## Usage

```sh
npm run create-game -- <name>     # e.g. marble_run  (lowercase, digits, _)
```

It copies `games/_template` to `games/<name>`, substitutes the name into
`package.json`, `game.config.ts`, `index.html`, `capacitor.config.ts`,
`native-resources/`, and the game `README.md`, then prints next steps. It
**git-adds nothing and installs nothing** — review the new directory, then commit
when ready. `node_modules`, `dist`, and `coverage` are never copied. It refuses
to overwrite an existing game or to accept an invalid name.

Fresh device shells are generated later with `npx cap add ios` or
`npx cap add android` from inside the game directory. Keep those generated
`ios/` and `android/` trees gitignored; committed native inputs live in
`native-resources/`. `verify-device` reapplies that recipe after `cap sync`. For
iOS signing, set `DEVELOPMENT_TEAM=<team id>` in the environment so
`verify-device` can pass it to `xcodebuild -allowProvisioningUpdates`; do not
hard-code a team id in the generated Xcode project.

The output passes `npm run audit` (structure + guardrail linters), typechecks,
and its inherited smoke test is green from the first commit.

## Workspace membership

`tools/create-game` is an npm workspace (listed explicitly in the root
`workspaces`, not via a `tools/*` glob) so its scaffold test
(`npm run test:unit --workspace=tools/create-game`, a hermetic tmp-dir fixture)
runs in the repo gate and CI matrix.
