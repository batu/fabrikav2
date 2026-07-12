# Matched task sets

The scored comparison uses matched briefs that repeat the same **operation
classes** with different copy, colors, assets, and geometry. The operation
classes are frozen here at U1; the concrete scored briefs are sealed by U10
inside the session packet (after both local parity and device shakedowns
pass) so no lane can rehearse them early.

`operation-classes.json` is the frozen template every matched brief must
cover. Two briefs are "matched" when they contain the same classes in the
same counts against the same frozen catalog and semantic contract.

Rules (from `goal.md` Comparison Protocol):

- Two matched briefs per arm; tool order counterbalanced; the assisted arm
  reverses tool order and uses fresh briefs.
- Editor-active time runs from brief reveal through editor-native publish;
  apply and device observation use separate timers.
- An unfinished task records its actual state rather than forcing completion.
- `unsupported-intent` is a terminal recorded outcome during a scored epoch.
