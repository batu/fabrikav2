# Native GrapesJS Marble round-trip evidence

Final baseline revision: `sha256-3038e49c37b6b3944cf91f795f5dd9233f85791580cd67d8d162bc2846b6a9be`.

The evidence proves editor-native page coverage, exact asset-byte enforcement, semantic identity, live copy, duplication, persistence through a full server restart, protected reset, and revision-addressed Preview. It intentionally does not claim phone fidelity; MR4 must build/capture the saved project on Android and run PixelSmith plus independent review.

Run `npm run verify --workspace=@fabrikav2/grapes-shell` for deterministic checks. Start the actual editor with `npm run dev --workspace=@fabrikav2/grapes-shell`.
