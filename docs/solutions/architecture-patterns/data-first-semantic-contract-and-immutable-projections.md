---
title: Data-first semantic contracts and immutable projections
module: packages/kernel
date: 2026-07-10
last_updated: 2026-07-11
problem_type: architecture_pattern
component: tooling
severity: high
category: architecture-patterns
applies_when:
  - Multiple consumers need one semantic identity and compatibility boundary
  - Editable authoring data must project into immutable runtime artifacts without becoming runtime authority
  - Untrusted presentation data must fail closed before editor load, publication, or apply
related_components:
  - testing_framework
tags:
  - semantic-contract
  - data-first
  - json-schema
  - deterministic-hashing
  - immutable-projection
  - fail-closed-validation
---

# Data-first semantic contracts and immutable projections

## Context

Fabrikav2 needed one vocabulary that a shell, editor, publisher, projector,
audit tool, and game template could consume without reconstructing presentation
semantics independently. The shell plan therefore defines one machine-readable
join across states, roles, instances, actions, runtime bindings, assets,
accessibility, publication compatibility, and projection schemas
(`docs/plans/2026-07-10-002-feat-grapesjs-shell-specialization-plan.md:512`).

The important authority split is that the contract defines functional sockets
and compatibility constraints. It does not become a third visual authority:
accepted presentation belongs to authoring, while runtime behavior remains in
Fabrikav2 (`docs/plans/2026-07-10-002-feat-grapesjs-shell-specialization-plan.md:57`).

## Guidance

### Keep one canonical registry

Store the registry as machine-readable JSON, then make TypeScript import,
validate, freeze, and expose that same object. The facade imports the JSON
directly (`packages/kernel/src/shellContract.ts:1`), derives lookups from it
(`packages/kernel/src/shellContract.ts:360`), and exports identity and state
lists only after parsing and freezing the registry
(`packages/kernel/src/shellContract.ts:3199`). A cross-consumer test keeps the
JSON file, TypeScript facade, and public exports on identical contract IDs and
versions (`packages/kernel/tests/shellContract.test.ts:218`).

Type declarations and validation code may live in TypeScript. The rule is that
there is no second runtime registry whose values can drift from the JSON.

### Separate source-raster eligibility from rendered geometry

An asset has intrinsic facts before it is rendered: encoded byte size, decoded
dimensions, aspect ratio, alpha, MIME type, and provenance. A semantic role has
different facts about the box the game renders: layout caps, safe bounds, and
touch minimums. Keep those domains separate. Asset slots own fitting and
`sourceRaster` eligibility; the root contract owns `assetRasterPolicy`; roles
own `geometryCaps` (`packages/kernel/contracts/shell-presentation.v1.json:11`,
`packages/kernel/contracts/shell-presentation.v1.json:169`,
`packages/kernel/contracts/shell-presentation.v1.json:258`).

Validate each domain against its own units. Source floors must fit within the
global raster edge budget, and per-asset limits must fit aggregate limits
(`packages/kernel/src/shellContract.ts:921`). Do not compare an intrinsic image
dimension in pixels to a rendered-role maximum: high-resolution source art may
legitimately render into a much smaller point box. A focused regression pins the
split and each independent coherence rule
(`packages/kernel/tests/shellContract.test.ts:304`).

### Keep editable input closed and inert

Define a declarative AST whose editable values are exhaustively enumerated.
The current contract permits bounded finite geometry and scalar values, fixed
enums, validated colors, plain Unicode copy, and semantic asset IDs that must
resolve through a publication catalog. It forbids CSS-, HTML-, URL-, attribute-,
script-, function-, expression-, and source-bearing fields, and it rejects
active `javascript:`, `data:`, and `blob:` schemes in copy
(`packages/kernel/contracts/shell-presentation.v1.json:771`).

Reject unsupported data instead of attempting to sanitize it into acceptance.
Local asset records must also prove a supported raster path and MIME type,
dimensions, slot compatibility, alpha policy, content hash, and provenance
(`packages/kernel/src/shellContract.ts:2236`).

### Treat schemas and parsers as one compatibility surface

Embedded JSON Schemas describe closed presentation, asset-catalog,
publication, projection-revision, and asset-identity roots
(`packages/kernel/contracts/shell-presentation.v1.json:827`). Runtime parsers
must independently enforce exact fields, semantic references, canonical order,
safe paths, and content identity. The contract parser verifies the embedded
schema metadata and closed roots (`packages/kernel/src/shellContract.ts:2151`).
Focused tests pin overlapping normalized and unsafe provenance-path cases at
both the runtime-parser and embedded-schema boundaries
(`packages/kernel/tests/shellContract.test.ts:757`,
`packages/kernel/tests/shellContract.test.ts:914`).

### Keep downstream seeds as wrappers, not authorities

A template seed may package sources, licenses, and a canonical asset catalog,
but it must not repeat role compatibility. The kernel contract's bidirectional
role-to-slot mapping is the authority (`packages/kernel/src/shellContract.ts:1745`);
the template manifest embeds the U1 catalog and deliberately contains no
`compatibleRoles` list (`games/_template/tests/unit/kenney-seed.test.ts:57`).

Audit the claims at the byte boundary. Resolve regular non-symlink files inside
configured real paths, compare approved and committed bytes and hashes, and
derive PNG dimensions and alpha from real chunk structure
(`games/_template/tests/unit/audit-kenney-seed.mjs:23`,
`games/_template/tests/unit/audit-kenney-seed.mjs:136`). Share that PNG fact
reader with the regression suite so prose bytes containing `tRNS` cannot be
mistaken for a transparency chunk
(`games/_template/tests/unit/png-facts.mjs:13`,
`games/_template/tests/unit/kenney-seed.test.ts:141`).

### Validate resolved variants against real safe rectangles

Sparse visual variants inherit from their family and instance base. Resolve
that effective presentation before checking visibility, assets, or geometry
(`packages/kernel/src/shellContract.ts:2519`). Validate every required variant
against the canonical safe-area profile and every supplied runtime profile
(`packages/kernel/src/shellContract.ts:2800`). An explicitly empty profile list
must fail rather than disabling geometry checks
(`packages/kernel/src/shellContract.ts:2812`).

Required actions must preserve their minimum visible count and remain inside
the projected safe rectangle at or above the larger of the contract and role
touch minimums (`packages/kernel/src/shellContract.ts:2874`). Tests should cover
hidden, transparent, undersized, overflowing, and slot-incompatible effective
variants (`packages/kernel/tests/shellContract.test.ts:537`).

### Canonicalize hostile JSON safely and bound the work

Canonical hashing should accept only JSON primitives, arrays, and plain
objects; normalize negative zero; and reject non-finite numbers, non-JSON
values, cycles, exotic prototypes, excessive depth, and excessive node counts
(`packages/kernel/src/shellContract.ts:795`). Build canonical objects with a
null prototype and lexicographically sorted keys so reserved keys such as
`__proto__` remain data rather than object behavior
(`packages/kernel/src/shellContract.ts:829`).

Bound collection traversal and diagnostic count as well as hashing. The
contract caps both, and adversarial tests exercise those limits
(`packages/kernel/src/shellContract.ts:408`,
`packages/kernel/tests/shellContract.test.ts:1038`).

### Bind complete content into domain-separated identities

A publication identity covers the declared contract identity and the hashes of
the saved project, portable export, canonical component records, and asset
catalog, plus page/state identity. A projection identity covers the declared
contract ID and version, full contract compatibility hash, source-publication
ID, and complete artifact records
(`packages/kernel/contracts/shell-presentation.v1.json:794`,
`packages/kernel/contracts/shell-presentation.v1.json:815`).

Canonicalize those fields, add a distinct domain for each identity type, hash
with SHA-256, and recompute the claimed ID while parsing
(`packages/kernel/src/shellContract.ts:859`,
`packages/kernel/src/shellContract.ts:873`). Checking only that an ID looks like
a hash does not prove it belongs to the supplied content.

### Generate immutable revisions, then select one

Write a complete projection under its content-derived revision identity. Check
the revision path, allowed and unique artifact paths, canonical artifact order,
required files, SHA-256 record syntax, contract compatibility, and projection
ID; bind the declared source-publication ID and artifact records into that ID
(`packages/kernel/src/shellContract.ts:2998`). The producer must separately hash
the actual artifact bytes before constructing those records. Downstream tools
should finish and validate the immutable candidate before atomically replacing
the selected projection pointer; they should never edit a selected revision in
place.

### Reuse behavior vocabulary before adding contract terms

The contract reuses the existing `GameScreenName` union
(`packages/kernel/src/game-config.ts:21`) and established Play, Settings,
Pause, Result, and Back action hooks rather than inventing parallel names. Three
V1 resolutions are intentionally explicit:

- `fail` is the canonical presentation state, the V1 level test hook is
  `test-lose`, the existing result presentation uses `lose`, and both canonical
  result states use `ResultCard`
  (`packages/kernel/contracts/shell-presentation.v1.json:71`,
  `packages/kernel/contracts/shell-presentation.v1.json:77`).
- `level` maps to the gameplay/HUD page with a `mechanic.mount` region and no
  `GameScreenName` (`packages/kernel/contracts/shell-presentation.v1.json:53`,
  `packages/kernel/contracts/shell-presentation.v1.json:85`).
- Settings Back uses the neutral `back` hook with `flow.settings-back`; its
  origin-aware destination remains runtime behavior, not editable presentation
  (`packages/kernel/contracts/shell-presentation.v1.json:762`).

These seams should change only through an explicit contract version, not local
consumer aliases.

## Why This Matters

A data-first contract lets independent consumers agree on semantic identity
without sharing implementation code or silently forking registries. Closed
inputs keep authoring data inert. Effective-variant and safe-rectangle checks
prevent a sparse override from hiding or shrinking the last required action.
Content-derived publication and projection IDs make mixed or hand-edited
revisions detectable: changing a declared source or artifact hash invalidates
the corresponding identity (`packages/kernel/tests/shellContract.test.ts:962`,
`packages/kernel/tests/shellContract.test.ts:980`).

## When to Apply

- Multiple consumers must share editable presentation while behavior and
  accessibility semantics remain protected.
- Authoring data crosses a trust boundary.
- Fixed-artboard intent must project onto device-derived safe areas.
- Generated output needs deterministic, auditable selection and rollback.

Do not use this AST as general DOM or CSS transport, and do not treat generated
projection files as another authoring authority. A new behavior, binding,
accessibility semantic, asset kind, or source fragment calls for a deliberate
contract version rather than an escape hatch.

## Examples

Parse untrusted authored data through the facade and pass the actual runtime
profiles being supported:

```ts
const presentation = parseShellPresentation(rawPresentation, {
  assetCatalog,
  viewportProfiles: [deviceViewport],
});
```

The parser checks semantic immutability, complete variants, compatible assets,
and effective action geometry before returning
(`packages/kernel/src/shellContract.ts:2574`). Likewise, accept a projection
revision only after `parseProjectionRevision()` has recomputed contract
compatibility and its content-derived ID
(`packages/kernel/src/shellContract.ts:2998`).

## Related

- [U1 shell specialization plan](../../plans/2026-07-10-002-feat-grapesjs-shell-specialization-plan.md)
- [Headless contract evidence](../../evidence/2026-07-10-grapes-shell-semantic-contract/evidence.md)
- Primary regression suite: `packages/kernel/tests/shellContract.test.ts:217`
