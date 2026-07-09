# design/

**Generated, git-committed, never hand-edited.** `tokens.css` (`--fab-*` custom
properties), `copy.ts` (localized UI text), and `assets.ts` (asset-id bindings)
are the output of the design-sheets round-trip — the format is the fabrikav2
ingester contract (`design-sheets/ingesters/fabrikav2/README.md`). A reskin edits
the sheet and re-runs `dsheets apply`, which rewrites these files; editing them by
hand is a defect. `assets/` holds the committed asset bytes indexed by basename.
