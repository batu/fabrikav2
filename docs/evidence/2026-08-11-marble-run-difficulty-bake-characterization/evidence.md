# Marble Run difficulty bake characterization

Date: 2026-08-11

Status: PASS. U2 exact reproduction and its bounded performance gate are complete.

## Authority

- Historical driver repository revision: `b3c3ae91bdfa8ca4f10e70da4823101f29d8dd92`
- Historical driver path: `games/marble_run/sugar3d/scripts/generate-levels.ts`
- Verified SHA-256: `d62a1a7756548989f4265a72e9085bb86e23b72d272348b785af830d47b64f20`
- Shipped-byte oracle: `src/levels/levels.generated.ts` and `src/levels/levels.manifest.generated.ts`

## Bounded results

- Levels 1 through 15 reproduced byte-exactly.
- Observed engine mismatches: 0.
- Observed serialization mismatches: 0.
- All 110 levels and manifest entries now reproduce byte-exactly.
- Level 12 exceeded a 5-second per-level checkpoint, then completed byte-exactly in 8.946 seconds at reseed 13 under a 30-second isolated ceiling.
- Level 16 exceeded a 15-second per-level checkpoint, then completed byte-exactly in 19.893 seconds at reseed 0 using the historical `butterfly` shape.
- The original unoptimized 110-level oracle consumed approximately 14 minutes at 100% CPU without returning and was terminated.
- The optimized oracle completes all 110 levels in 34.524 seconds with zero serialization, engine, or provenance mismatches.
- Final per-board timing: p50 54.19 ms, p95 927.73 ms, maximum 8,558.85 ms.
- The level 16 optimization benchmark improved from 20,551.07 ms to 638.3 ms while retaining identical bytes.

## Verification

The bounded diagnostic tests pass:

```text
npm run test:unit -w @fabrikav2/marble_run -- --run src/levels/level-bake.test.ts -t bounded --reporter=verbose
Test Files  1 passed (1)
Tests       2 passed | 4 skipped (6)
```

No generated level or manifest file was modified. The exact 110-level reproduction oracle passes.

## Resolution

Tentative placements now use an equivalent boolean greedy-peel solver, compile immutable gate geometry once, reuse typed scratch buffers, and flood empty connectivity once per wave. Final candidate evidence still uses the route-producing solver. U3 may proceed without weakening the baseline contract.
