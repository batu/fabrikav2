# Find the Bird runtime strategy digest

## Result

- Baseline median `runtime_ready_sum_ms`: 5897.42 ms.
- Best retained median: 3882.40 ms at iteration 8, a 2015.02 ms (34.2%) reduction.
- All best-candidate gates passed: home and first-level readiness, consistent gameplay state, zero local request failures, zero page errors, zero texture growth, and cached worst case below 3.5 seconds.
- The run stopped after iterations 9-11 produced three consecutive non-wins within or beyond the 120 ms noise threshold.

## Retained strategy

1. Start current-level prewarm in Home's first idle window; the extra 300 ms timer withheld useful work.
2. Reveal the board when it is actually ready instead of preserving presentation dwell that contributed more than one second to the measured path.
3. Preserve safe bundled level data across scene shutdown while continuing to revoke and invalidate Object URL-backed data.
4. Share concurrent level-index resolution without caching transient manifest fallback as a final answer.
5. Keep deferred home-only art cancellable, requeue idle work after visibility races, avoid per-frame camera-pose allocation, and persist only the active level index on level entry.

## Rejected strategy

- Parallel image decode at concurrency four moved cost rather than reducing it and worsened frame-gap diagnostics.
- A shorter forced idle deadline was metric-neutral and made background scheduling more aggressive without evidence.
- Further micro-optimizations after iteration 8 did not clear the benchmark's noise threshold.

## Guardrails learned

- Runtime-manifest refresh must occur before using the cached resolved index so a transient fallback can recover to live data.
- Bundled cache retention is safe only when the level created no revocable Object URLs.
- Human hitboxes, current pixels, sprite placement, pickup behavior, and durable progression remain immutable for this run.
- Future work should profile provider initialization and required-asset fetch topology separately; neither should be changed without a new frozen baseline and device motion evidence.
