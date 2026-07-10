# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Shell presentation and projection

### Shell Presentation Contract

The versioned vocabulary that fixes semantic identity, compatibility rules, and allowable presentation data shared by authoring, generation, audit, and runtime consumers; it constrains those systems without owning accepted presentation or runtime behavior.

### Semantic Role

A theme-neutral function that a shell object fulfills, distinct from a concrete object occurrence or its visual treatment.

### Semantic Instance

A stable identity for one concrete occurrence of a Semantic Role, preserved across authoring and generated projections.

### Runtime Binding

The non-editable connection between a Semantic Instance and the runtime state read, action, toggle, or region behavior it uses.

### Asset Slot

A semantic replacement socket whose role compatibility, geometry, fitting, alpha, format, and provenance rules constrain the local raster assets it accepts.

### Published Revision

An immutable content identity joining accepted authoring state with the portable representation and catalog evidence used to check compatibility.

### Projection Revision

An immutable generated artifact bundle derived from a Published Revision and selected for runtime consumption; it is never editable presentation authority.

## Relationships

The Shell Presentation Contract defines the identities and compatibility rules that a Published Revision claims to satisfy. A Projection Revision names its source Published Revision and binds the generated artifacts that runtime consumers may select.

## Flagged ambiguities

- “Fail” is the canonical presentation state; V1 names the level test action `test-lose`, while existing result presentation uses “lose.” “Lose” is not another presentation-state identity.
