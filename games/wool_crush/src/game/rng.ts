/**
 * Tiny seeded PRNG + Fisher-Yates shuffle. Deterministic given the seed, so a
 * level's dragon is reproducible across runs (the conservation + determinism
 * invariants the kernel is tested against both depend on this).
 *
 * Pure math, no engine imports — mirrors the headless discipline of
 * marble_run's puzzle module (`generate.ts` seeds the same way).
 */

/** mulberry32 — 32-bit seeded generator returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Return a shuffled copy of `arr` using `rng`. Input is never mutated. */
export function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
