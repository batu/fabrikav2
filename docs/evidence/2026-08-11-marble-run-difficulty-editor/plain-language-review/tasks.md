# Plain-language Pattern review

## Task 1 — Make Pattern understandable without generator vocabulary

- Status: active
- Goal: A designer can understand and edit the first 11 levels and the repeating journey without knowing the generator's internal terms.
- Why now: The deployed Pattern view exposes `spike`, `band`, `recover`, `climax`, `cycle`, `offset`, and `maximum` directly.
- User lens: Scan first; select one step; edit only that step; learn unfamiliar behavior beside the control.
- Pre-shot target: authenticated live Pattern view at 1440 x 900.
- Acceptance criteria:
  1. No internal role names appear in visible Pattern copy or options.
  2. The first 11 levels and repeating journey remain visible as overviews.
  3. Only the selected item exposes detailed controls.
  4. Repetition controls explain their effect in plain language.
  5. Existing authored values and edit behavior remain intact.
- Expected result: two calm sequence overviews with one focused editor each, followed by optional later-journey tuning.
- Constraints: retain the existing editorial visual system; do not add duplicate help panels or change generation semantics.
- Out of scope: Ranges, Boards, focused Level editor, generator model, export workflow.
- Verification: matched screenshots, interaction checks, unit tests, typecheck, lint, production build, live Portal check.

