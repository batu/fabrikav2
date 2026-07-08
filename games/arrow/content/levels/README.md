# Level recipes (YAML)

Each file in this directory is one level recipe. `tools/levels-gen.mjs` reads them and emits `src/game/levels-data.ts` — the typed array + `PACKS` grouping consumed by `src/game/levels.ts`.

Run the generator:

```bash
npm run levels:gen      # regenerate levels-data.ts from yamls
npm run levels:check    # CI guard — fail if the committed file drifts
```

## Filesystem layout

Either:

- **Flat** (`levels/*.yaml`) — legacy shape, still supported.
- **Per-pack subdirs** (`levels/<pack>/*.yaml`) — preferred, one directory per pack.

Filenames must match `^\d{2}-[a-z0-9-]+\.yaml$` (2-digit zero-pad + kebab-case slug). The generator groups recipes by `meta.pack`, not by directory, so the two layouts coexist cleanly. Within a pack, levels play in `meta.indexInPack` order.

## Recipe schema

```yaml
cols: 5             # required, int [3, 30] — grid width
rows: 7             # required, int [3, 30] — grid height
arrowCount: 3       # required, int >= 1
opts:               # required — path-generator knobs
  minLen: 2         # required, int >= 2
  maxLen: 3         # required, int >= minLen
  bendProb: 0.1     # required, float [0, 1]
seed: 101           # required, int [0, 2^30) — unique across all recipes
blockedT1: [0, 1]   # OPTIONAL — [min, max] arrows blocked on turn 1.
                    # Omit to accept any solvable layout.
meta:               # required
  pack: all # required kebab-case pack slug
  indexInPack: 1    # required, int [1, 99]
  title: Intro      # optional, 1..60 chars
  difficulty: easy  # optional, one of easy | medium | hard
```

### Validator-enforced invariants

The generator fails the build if any recipe violates:

- unknown top-level or `opts` keys (typo defense)
- `seed` uniqueness across every recipe
- `(pack, indexInPack)` uniqueness across every recipe
- `blockedT1[1] <= arrowCount` and `blockedT1[0] >= 0`
- `meta.pack` matches `^[a-z0-9]+(-[a-z0-9]+)*$`
- filename matches `^\d{2}-[a-z0-9-]+\.yaml$`

Runtime (`levels.ts`) additionally proves solvability per recipe via the greedy solver; unsolvable recipes are rejected (dev) or replaced with a null slot (prod).

## Why YAML

Non-engineers and LLMs can author a level by editing text — no TypeScript syntax to get wrong, no quoting weirdness. The generator is the one place where "what the recipe means" is encoded — renaming or removing a field fails loudly instead of silently mis-parsing.

## Supported scalars

- Integers and floats: `5`, `0.1`
- Quoted strings (for `meta.title` when it contains `:` or `#`): `"Hash # Tag"`
- Flow sequences: `[0, 1]`
- Comments: `# rest-of-line comment` (outside quoted strings)
- Leading UTF-8 BOM is stripped
- Tabs are rejected (use 2-space indent)
