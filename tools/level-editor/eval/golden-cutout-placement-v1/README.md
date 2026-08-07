# Golden cutout placement v1

This frozen set records Batu's explicit editor reviews from 2026-08-07 onward.

- `reviewedLevels` identifies levels whose complete final state was approved. Every
  bird in one of these levels is labeled; merely opening a level is not approval.
- `approved` is the complete final-state corpus. `placementVerdict=corrected`
  means the final box was manually adjusted, while `keep` means the machine box
  was inspected and approved without adjustment.
- `needsRedo` is the binary review target for deciding whether the original
  cutout needed another extraction. Successful extraction jobs are positive;
  reviewed birds with no retry are negative. Interrupted requests are `null` and
  excluded from training rather than guessed.
- `redoAction` preserves the actual human action (`extract`, `keep`, or
  `extract-request-unconfirmed`). There are currently no reviewed full-scene
  regeneration examples, so `needsRedo` must not be described as a trained
  regenerate-scene classifier yet.
- Positive redo rows retain the rejected input sprite by immutable Git commit,
  path, blob id, and SHA-256. The current `spriteSha256` is the approved result.
- `placementTrials` contains the leakage-safe optimizer input: the exact
  machine-before-human box and final target for corrections, plus explicit
  no-change trials for approved keeps. A correction whose pre-edit state cannot
  be recovered remains in `approved` but is excluded from optimization.
- `placement` is correction-trial supervision for fitting an extracted sprite
  over the painted bird. It is the original v1 subset retained for compatibility;
  new optimization should use `placementTrials`.
- `padding` is supervision for choosing the extraction crop. It must not influence placement scoring.
- `initialBox` is the geometry immediately before the human placement correction.
- `targetBox` is the final human-authored geometry.
- `spriteSha256` prevents a later extraction from silently changing the benchmark input.

Evaluation must split by level, not by bird, because birds sharing one scene are
not independent samples. A completed full-level review is authoritative for
`keep`; job history alone is authoritative only for whether a retry occurred.
New correction trials must still come from explicit editor changes and must
retain their exact pre-edit geometry.
