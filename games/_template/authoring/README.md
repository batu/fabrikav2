# Authoring

Editable, tool-specific source state lives here. Give each authoring frontend a
named subdirectory, keep its saved project and immutable publications together,
and treat that state as the authority for its generated lane.

Runtime-facing generated files belong in `../design/`. Do not edit those
projections as a second source of truth.
