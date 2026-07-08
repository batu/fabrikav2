# Find The Dog

`find_the_dog` is a v2 game scaffold created with `npm run create-game -- find_the_dog`.

This workspace starts from the shared template and is ready for a game-specific
design pass. Keep gameplay code in `src/`, source references in `refs/`,
promoted evidence in `evidence/`, and design-owned copy, tokens, and assets in
`design/`.

Shared workspace dependencies are declared up front: `@fabrikav2/kernel`,
`@fabrikav2/ui`, `@fabrikav2/sdk`, and `@fabrikav2/testkit`.

Useful checks:

- `npm run typecheck -w @fabrikav2/find_the_dog`
- `npm run test:unit -w @fabrikav2/find_the_dog`
- `npm run audit`
