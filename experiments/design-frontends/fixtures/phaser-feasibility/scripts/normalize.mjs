// Canonicalization for generated outputs (plan KTD8): normalization may only
// touch fields in the enumerated volatile registry — each entry is a recorded
// feasibility fact for goal-U1 — and must never rewrite semantic content
// (IDs, geometry, copy, bindings). A semantic diff between two unchanged
// generations is a determinism failure, never a normalization candidate.

// Volatile fields observed in Phaser Editor 5.0.2 generated output.
// EMPTY on purpose: the recorded double generation was byte-identical, so no
// canonicalization is needed or permitted. Any future entry must name the
// pattern, the reason, and the evidence that it is presentation-only.
export const VOLATILE_REGISTRY = [];

export function normalize(text, registry = VOLATILE_REGISTRY) {
  let out = text;
  const applied = [];
  for (const entry of registry) {
    const before = out;
    out = out.replace(entry.pattern, entry.replacement);
    if (out !== before) applied.push(entry.name);
  }
  return { text: out, applied };
}

// Compare two generations of the same artifact.
export function compareGenerations(gen1, gen2, registry = VOLATILE_REGISTRY) {
  if (gen1 === gen2) return { verdict: "byte-identical", applied: [] };
  const n1 = normalize(gen1, registry);
  const n2 = normalize(gen2, registry);
  if (n1.text === n2.text) {
    return { verdict: "normalized-identical", applied: [...new Set([...n1.applied, ...n2.applied])] };
  }
  return { verdict: "determinism-failure", applied: [] };
}
