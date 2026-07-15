# Native GrapesJS Marble round-trip evidence

Final baseline revision: `sha256-17adbefdad1b45f1fc40be7553935f1c26d7b576f95d63e0a70605d41ce4e236`.

The evidence proves editor-native page coverage, exact asset-byte enforcement, semantic identity, live copy, duplication, persistence through a full server restart, protected reset, optimistic concurrency, selected-image replacement, and revision-addressed Preview. A closed per-type component schema rejects unknown, scriptable, embedded-document, and unfrozen media structures before URL validation while preserving the real editor's copy, visibility, duplicate, save, and reset operations. The final publication freezes and hashes every rendered dependency; read-time integrity rejects project, manifest, token, font, or image tampering under a stale revision stamp. The final nine Preview captures also include the canonical F1-F10 aesthetics repair. It intentionally does not claim phone fidelity; MR4 must build/capture the saved project on Android and run PixelSmith plus independent review.

Run `npm run verify --workspace=@fabrikav2/grapes-shell` for deterministic checks. Start the actual editor with `npm run dev --workspace=@fabrikav2/grapes-shell`.
