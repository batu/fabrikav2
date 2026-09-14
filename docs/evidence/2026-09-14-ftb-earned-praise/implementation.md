# Earned pickup praise

User decisions: praise only genuinely hidden birds or a combo; keep praise at its original screen position during camera movement. Reuse existing difficulty work; do not reorder levels.

- [x] Recover prior ranking: Dog used per-target subjective visual ratings, not a completed Gemini detection batch. No equivalent Bird ledger found.
- [x] Review three current bundled Bird levels plus the older waterfall export: 68 visual ratings. Gemini attempt stopped on HTTP 400; actual cost unconfirmed; no runtime model calls.
- [x] Implement ordinary-find silence, hard-find praise, and three unassisted finds with gaps at most four seconds. Tutorial, hints, misses, and suspension break the combo. A hinted target stays ineligible after dismissing its circle.
- [x] Verify policy, loader provenance, and real iPhone rendering including camera movement; review changes. 597 tests, typecheck, scoped ESLint, 40 scorer tests, native physical-input journey and motion/gameplay review pass.
- [x] Ordinary iPhone build installed/launched; progress and wallet preserved. Portal playback and file hash verified. Delivery tracked in [PR #92](https://github.com/batu/fabrikav2/pull/92); GitHub reports no required checks, while hosted CI is queued alongside older runs. Merge only through the normal protected-check-aware command.

Unscored or changed artwork must not receive hard-find praise. Combo feedback remains available in all levels. Scores are subjective visual estimates, not calibrated player difficulty.
