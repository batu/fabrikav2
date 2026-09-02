# design/assets/

Committed asset bytes (`.png`, …) referenced by `design/assets.ts`. The initial
semantic fixtures come from Kenney's CC0 UI Pack and Game Icons packs; exact
source paths, slot identities, descriptions, MIME types, dimensions, byte sizes,
alpha facts, and copied-byte hashes are in the manifest's canonical U1
`assetCatalog`. Filenames carry both slot and semantic identity; they are runtime
vocabulary, not source-pack vocabulary. Future presentation application replaces
these bindings through that catalog rather than making this folder a second theme
authority. Human reference imagery that is *not* shipped belongs in `refs/`, not
here.

Audit the committed bytes against an approved local asset library by configuring
its root explicitly:

```sh
KENNEY_APPROVED_SOURCE_ROOT=/path/to/approved/assets \
  npm run audit:kenney -w @fabrikav2/game-template
```
