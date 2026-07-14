// Semantic carrier vocabulary for the Phaser Editor authoring lane (U5, KTD-B).
//
// The Phaser Editor `Semantic` user component (carried over from U2 card
// 43Qvbih7) is a flat FIVE-STRING carrier attached to scene objects:
//
//   Semantic.fabSemanticId   — the instance identity (dot/kebab grammar)
//   Semantic.fabRole         — the kernel roleId this object plays
//   Semantic.fabBinding      — the kernel bindingId this object carries
//   Semantic.fabSlot         — the kernel assetSlotId (or "" when the role has none)
//   Semantic.fabVariant      — the state-family variant key ("" for the base object)
//
// These five strings are only the EDITOR-SIDE CARRIER. The validation authority
// is the frozen kernel v2 contract (`shellPresentationContractV2`): every role,
// binding, slot, family, and prototype id below is DERIVED from that contract at
// module load — nothing is hardcoded, because the shell vocabulary is per-game
// contract data, never a literal baked into the tool (docs/solutions trust-anchor
// learning; card comment 3 seam audit). extractV2.ts maps a carrier back into a
// full `ShellPresentationInstance` and validates it with `parseShellPresentationV2`.
import { shellPresentationContractV2 } from '@fabrikav2/kernel';
import type {
  ShellInstanceDefinition,
  ShellRoleDefinition,
  ShellStateIdV2,
} from '@fabrikav2/kernel';

/** The five carrier fields present on a scene object with the `Semantic` component. */
export const SEMANTIC_COMPONENT = 'Semantic' as const;
export const CARRIER_FIELDS = [
  'fabSemanticId',
  'fabRole',
  'fabBinding',
  'fabSlot',
  'fabVariant',
] as const;
export type CarrierField = (typeof CARRIER_FIELDS)[number];

/** A carrier read off a scene object (already lifted out of the `Semantic.` prefix). */
export interface SemanticCarrier {
  fabSemanticId: string;
  fabRole: string;
  fabBinding: string;
  fabSlot: string;
  fabVariant: string;
}

/** Stable instance-identity grammar (mirrors the kernel `SEMANTIC_ID_PATTERN`). */
export const SEMANTIC_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

// --- Vocabulary derived from the frozen contract (no hardcoded strings) --------

const contract = shellPresentationContractV2;

export const CANONICAL_STATE_IDS: readonly ShellStateIdV2[] = contract.states.map(
  (state) => state.id,
);

export const ROLE_IDS: ReadonlySet<string> = new Set(contract.roles.map((role) => role.id));
export const BINDING_IDS: ReadonlySet<string> = new Set(
  contract.bindings.map((binding) => binding.id),
);
export const ASSET_SLOT_IDS: ReadonlySet<string> = new Set(
  contract.assetSlots.map((slot) => slot.id),
);
export const STATE_FAMILY_IDS: ReadonlySet<string> = new Set(
  contract.stateFamilies.map((family) => family.id),
);

const rolesById = new Map<string, ShellRoleDefinition>(
  contract.roles.map((role) => [role.id, role]),
);
const prototypesById = new Map<string, ShellInstanceDefinition<ShellStateIdV2>>(
  contract.instances.map((instance) => [instance.id, instance]),
);
const familyRequiredVariants = new Map<string, readonly string[]>(
  contract.stateFamilies.map((family) => [family.id, family.requiredVariants]),
);

/** Look up a canonical prototype instance by its contract id, or undefined. */
export function prototype(
  id: string,
): ShellInstanceDefinition<ShellStateIdV2> | undefined {
  return prototypesById.get(id);
}

/** Look up a role definition by id, or undefined. */
export function role(id: string): ShellRoleDefinition | undefined {
  return rolesById.get(id);
}

/** The required variant keys for a state family (e.g. `button` → enabled/pressed/disabled). */
export function requiredVariants(stateFamilyId: string): readonly string[] {
  return familyRequiredVariants.get(stateFamilyId) ?? [];
}

/** Read the five carrier strings off a raw scene object, defaulting missing to "". */
export function readCarrier(obj: Record<string, unknown>): SemanticCarrier {
  const read = (field: CarrierField): string => {
    const value = obj[`${SEMANTIC_COMPONENT}.${field}`];
    return typeof value === 'string' ? value : '';
  };
  return {
    fabSemanticId: read('fabSemanticId'),
    fabRole: read('fabRole'),
    fabBinding: read('fabBinding'),
    fabSlot: read('fabSlot'),
    fabVariant: read('fabVariant'),
  };
}

/** True when a raw scene object declares the `Semantic` component. */
export function hasSemanticComponent(obj: Record<string, unknown>): boolean {
  const components = obj['components'];
  return Array.isArray(components) && components.includes(SEMANTIC_COMPONENT);
}
