# design/assets/

Committed asset bytes (`.svg`, `.png`, …) referenced by `design/assets.ts`. The
file basename, lowercased with its extension stripped, is the asset id the
ingester indexes (`placeholder_logo.svg` -> id `placeholder_logo`). This is a
generated, design-sheets-owned directory — add or replace assets through the
sheet round-trip, not by dropping files here ad hoc. Human reference imagery that
is *not* shipped belongs in `refs/`, not here.
