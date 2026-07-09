# Wool Crush

`wool_crush` is a v2 game scaffold created with `npm run create-game -- wool_crush`.

This workspace starts from the shared template and is ready for a game-specific
design pass. Keep gameplay code in `src/`, source references in `refs/`,
promoted evidence in `evidence/`, and design-owned copy, tokens, and assets in
`design/`.

Shared workspace dependencies are declared up front: `@fabrikav2/kernel`,
`@fabrikav2/ui`, `@fabrikav2/sdk`, and `@fabrikav2/testkit`.

Native shell inputs live in `native-resources/`. Before the first device run,
create the generated shell with `npx cap add ios` or `npx cap add android`;
`verify-device` reapplies the committed recipe after `cap sync`. For iOS
signing, set `DEVELOPMENT_TEAM=<team id>` in the environment instead of
hard-coding it in the generated Xcode project.

Useful checks:

- `npm run typecheck -w @fabrikav2/wool_crush`
- `npm run test:unit -w @fabrikav2/wool_crush`
- `npm run audit`
