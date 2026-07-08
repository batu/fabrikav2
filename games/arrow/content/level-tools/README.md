# games/arrow/tools

Two layouts live here:

**Flat scripts (`tools/*.mjs`, `tools/*.py`, `tools/*.mts`)**
One-off utilities: build-time codegen (`levels-gen.mjs`), playtest
drivers (`adb-playtest.mjs`), ad-hoc analysis (`retry-budget-audit.mjs`).
No package, no tests, no dependencies beyond the game's `node_modules`.
When a script needs dependencies, grows past ~200 lines, or acquires
its own test suite, **promote it** into the subdirectory layout below.

**Subdirectory packages (`tools/<name>/`)**
Self-contained packages with their own dependency manifest, tests, and
lifecycle. These run as `cd tools/<name> && uv run ...` or `npm run`.

| Subdir          | Language | Purpose                                           |
|-----------------|----------|---------------------------------------------------|
| `icon2level/`   | Python   | Icon/emoji → arrow level pipeline (Phase 2+).     |

The flat layout is fine while a script is a leaf. The subdir layout is
the right home once a tool has its own dependencies or ships a CLI.
Mixing a Python pyproject with `tools/*.mjs` at the same directory
level would force every node consumer of `tools/` to learn about
Python; the subdir boundary keeps the ecosystems orthogonal.
