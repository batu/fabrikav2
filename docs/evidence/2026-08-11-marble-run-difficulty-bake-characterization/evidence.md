# Marble Run difficulty bake characterization

Date: 2026-08-11

Status: BLOCKED at U2. Product approval is required before U3 under the implementation plan.

## Authority

- Historical driver repository revision: `b3c3ae91bdfa8ca4f10e70da4823101f29d8dd92`
- Historical driver path: `games/marble_run/sugar3d/scripts/generate-levels.ts`
- Verified SHA-256: `d62a1a7756548989f4265a72e9085bb86e23b72d272348b785af830d47b64f20`
- Shipped-byte oracle: `src/levels/levels.generated.ts` and `src/levels/levels.manifest.generated.ts`

## Bounded results

- Levels 1 through 15 reproduced byte-exactly.
- Observed engine mismatches: 0.
- Observed serialization mismatches: 0.
- Remaining uncharacterized levels: 95, reported as `missing-provenance` rather than guessed as matches.
- Level 12 exceeded a 5-second per-level checkpoint, then completed byte-exactly in 8.946 seconds at reseed 13 under a 30-second isolated ceiling.
- Level 16 exceeded a 15-second per-level checkpoint, then completed byte-exactly in 19.893 seconds at reseed 0 using the historical `butterfly` shape.
- The unbounded 110-level oracle consumed approximately 14 minutes at 100% CPU without returning and was terminated.

## Verification

The bounded diagnostic tests pass:

```text
npm run test:unit -w @fabrikav2/marble_run -- --run src/levels/level-bake.test.ts -t bounded --reporter=verbose
Test Files  1 passed (1)
Tests       2 passed | 4 skipped (6)
```

No generated level or manifest file was modified. Exact 110-level reproduction remains an unweakened test oracle, but it has not completed and therefore has not passed.

## Decision required

The plan permits U3 only after exact 110-level reproduction. Continuing by loading committed boards as the immutable baseline and generating only edited levels requires explicit product approval. The alternative is to optimize or reconstruct the bake composition until the complete exact oracle finishes within a usable bound.
