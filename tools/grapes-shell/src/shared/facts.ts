import type { ShellPresentationInstance } from "@fabrikav2/kernel";

// U+00B7 middle dot, matching the seed copy separators exactly. Changing it would
// change the seeded copy bytes and therefore the P0 project/publication hashes.
export const FACT_SEPARATOR = " · ";

interface BindingFactSpec {
  // The runtime/store binding whose value this fact reflects. The fact is owned
  // by that binding (game state + store), never by editable designer copy.
  readonly bindingId: string;
  // The exact locked fact segment a player must read.
  readonly fact: string;
  // Pure-read facts (labelEditable === false) own the entire copy field; action
  // facts keep an editable call-to-action label in front of the locked fact.
  readonly labelEditable: boolean;
  // The neutral seed label for an action fact (ignored for pure-read facts).
  readonly defaultLabel: string;
  // Which of the reviewer-named facts this is, for legible error/UI text.
  readonly kind: "reward" | "balance" | "cost" | "price and outcome" | "rewarded-ad mechanic";
}

// Runtime/store facts that the game binding owns, NOT free designer copy. Values
// are source-grounded, not demonstration amounts: shell_proof_phaser's
// TemplateShellController seeds reward = 5, balance = 25, continueCost = 10; the
// proofShopCatalog rescue_bundle carries price $4.99 and outcome
// "Continue this level"; the double-claim is gated on watching a rewarded ad.
//
// Keyed by prototypeInstanceId (not the literal instance id) so a duplicated fact
// instance inherits the same lock and cannot become an editable back door to a
// reward, balance, cost, price, or outcome.
const BINDING_FACTS: Readonly<Record<string, BindingFactSpec>> = {
  "win.reward": {
    bindingId: "state.reward-amount",
    fact: "5 Coins earned",
    labelEditable: false,
    defaultLabel: "",
    kind: "reward",
  },
  "fail.currency": {
    bindingId: "state.primary-currency",
    fact: "25 Coins",
    labelEditable: false,
    defaultLabel: "",
    kind: "balance",
  },
  "fail.continue-coins": {
    bindingId: "flow.continue-coins",
    fact: "10 Coins",
    labelEditable: true,
    defaultLabel: "Continue",
    kind: "cost",
  },
  "fail.bundle": {
    bindingId: "commerce.bundle",
    fact: `$4.99${FACT_SEPARATOR}Continue this level`,
    labelEditable: true,
    defaultLabel: "Rescue bundle",
    kind: "price and outcome",
  },
  "win.claim-double": {
    bindingId: "flow.claim-double",
    fact: "Watch ad",
    labelEditable: true,
    defaultLabel: "Claim 2x",
    kind: "rewarded-ad mechanic",
  },
};

export interface BindingFact extends BindingFactSpec {
  readonly prototypeInstanceId: string;
}

export function bindingFactForPrototype(prototypeInstanceId: string): BindingFact | undefined {
  const spec = BINDING_FACTS[prototypeInstanceId];
  return spec ? { ...spec, prototypeInstanceId } : undefined;
}

export function isFactBearingInstance(
  instance: Pick<ShellPresentationInstance, "prototypeInstanceId">,
): boolean {
  return instance.prototypeInstanceId in BINDING_FACTS;
}

// Compose the persisted copy from an editable label. Pure-read facts have no
// editable label and always render the locked fact verbatim; an emptied action
// label collapses to the bare fact so the store value is never lost.
export function composeFactCopy(prototypeInstanceId: string, label: string): string {
  const spec = BINDING_FACTS[prototypeInstanceId];
  if (!spec) throw new Error(`No binding fact registered for prototype "${prototypeInstanceId}".`);
  if (!spec.labelEditable) return spec.fact;
  const trimmed = label.trim();
  return trimmed ? `${trimmed}${FACT_SEPARATOR}${spec.fact}` : spec.fact;
}

// The designer-owned label of an action fact, derived by removing the locked fact
// segment. Returns "" for pure-read facts (they own no editable label).
export function deriveEditableLabel(prototypeInstanceId: string, copy: string | undefined): string {
  const spec = BINDING_FACTS[prototypeInstanceId];
  if (!spec || !spec.labelEditable) return "";
  const text = copy ?? "";
  const suffix = `${FACT_SEPARATOR}${spec.fact}`;
  if (text.endsWith(suffix)) return text.slice(0, -suffix.length);
  if (text === spec.fact) return "";
  return text;
}

// The single rule the editor, CLI, and publisher all fail closed on: a copy value
// belonging to a prototype that carries a binding fact must still surface that
// exact fact. `copyLabel` names the offending surface for the error message (an
// instance id, or `id#variant` for a named variant). Returns a human-readable
// violation message, or undefined when the fact is intact.
export function factCopyViolation(
  prototypeInstanceId: string,
  copyLabel: string,
  copy: string | undefined,
): string | undefined {
  const spec = BINDING_FACTS[prototypeInstanceId];
  if (!spec) return undefined;
  const value = copy ?? "";
  if (spec.labelEditable) {
    const suffix = `${FACT_SEPARATOR}${spec.fact}`;
    const intact = value === spec.fact || (value.endsWith(suffix) && value.length > suffix.length);
    return intact
      ? undefined
      : `Instance "${copyLabel}" must keep its binding-derived ${spec.kind} "${spec.fact}"; that value is owned by binding "${spec.bindingId}", not editable copy.`;
  }
  return value === spec.fact
    ? undefined
    : `Instance "${copyLabel}" copy is the binding-derived ${spec.kind} owned by "${spec.bindingId}" and must read "${spec.fact}".`;
}

// The base-presentation fact check. Keyed by prototype, so a duplicated fact
// instance is checked too. Named variants are checked separately by the caller
// (a variant that leaves copy unset inherits the already-checked base copy).
export function bindingFactCopyViolation(
  instance: Pick<ShellPresentationInstance, "id" | "prototypeInstanceId" | "presentation">,
): string | undefined {
  return factCopyViolation(instance.prototypeInstanceId, instance.id, instance.presentation.copy);
}
