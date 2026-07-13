// Scene set → ShellPresentationDocumentV2 extraction (U5, KTD-B).
//
// The seven `.scene` files are the sole editable authority. The kernel v2
// contract is the VALIDATION authority: this module lifts each scene's semantic
// objects into a `ShellPresentationDocumentV2` and that document is validated by
// `parseShellPresentationV2`. The five carrier strings on a scene object are only
// the carrier — every non-editable field (roleId/bindingId/parentInstanceId/
// stateFamilyId/actionId/accessibility) is taken from the object's canonical
// PROTOTYPE, so an authored scene cannot drift the contract's semantic spine; it
// can only overlay the EDITABLE presentation (geometry/order/visibility/copy/
// per-object colors/assetId).
//
// A `buildCanonicalDocument()` returns the clean-P0 baseline directly from the
// contract prototypes; `extractDocument()` overlays a scene set onto that
// baseline. Both are validated by the same kernel parser.
import { shellPresentationContractV2 } from '@fabrikav2/kernel';
import type {
  ShellPresentationDocumentV2,
  ShellPresentationInstance,
  ShellPresentationPage,
  ShellDefaultPresentation,
  ShellVisualPresentation,
  ShellInstanceDefinition,
  ShellStateIdV2,
} from '@fabrikav2/kernel';
import { prototype, role as roleOf, requiredVariants } from './semantic.ts';
import type { SceneDoc, SceneGeometry, SemanticObject } from './sceneModel.ts';
import type { Catalog } from './catalog.ts';
import { indexById } from './catalog.ts';

const contract = shellPresentationContractV2;
export const CANVAS = {
  width: contract.canonicalCanvas.width,
  height: contract.canonicalCanvas.height,
};

const anchorsById = new Map(contract.anchors.map((a) => [a.id, a]));
const statesById = new Map(contract.states.map((s) => [s.id, s]));
const instancesByState = new Map<ShellStateIdV2, ShellInstanceDefinition<ShellStateIdV2>[]>();
for (const instance of contract.instances) {
  const list = instancesByState.get(instance.stateId) ?? [];
  list.push(instance);
  instancesByState.set(instance.stateId, list);
}

/** The (x,y) anchor fraction for a role's declared anchor. */
function anchorFor(roleId: string): { x: number; y: number } {
  const r = roleOf(roleId);
  const anchor = r ? anchorsById.get(r.anchor) : undefined;
  return anchor ?? { x: 0.5, y: 0.5 };
}

/** Synthesize the family's required variants as empty (base-inheriting) overlays. */
function synthesizeVariants(stateFamilyId: string): Record<string, ShellVisualPresentation> {
  const out: Record<string, ShellVisualPresentation> = {};
  for (const variant of requiredVariants(stateFamilyId)) out[variant] = {};
  return out;
}

/** Build one canonical instance straight from its prototype (no scene overlay). */
function canonicalInstance(
  proto: ShellInstanceDefinition<ShellStateIdV2>,
): ShellPresentationInstance {
  const instance: ShellPresentationInstance = {
    id: proto.id,
    prototypeInstanceId: proto.id,
    parentInstanceId: proto.parentInstanceId,
    roleId: proto.roleId,
    bindingId: proto.bindingId,
    stateFamilyId: proto.stateFamilyId,
    accessibility: proto.accessibility,
    presentation: proto.defaultPresentation,
    variants: synthesizeVariants(proto.stateFamilyId),
  };
  if (proto.actionId !== undefined) instance.actionId = proto.actionId;
  return instance;
}

/** The clean-P0 baseline document, derived directly from the frozen prototypes. */
export function buildCanonicalDocument(): ShellPresentationDocumentV2 {
  const pages: ShellPresentationPage<ShellStateIdV2>[] = contract.states.map((state) => ({
    stateId: state.id,
    editorPageId: state.editorPageId,
    instances: (instancesByState.get(state.id) ?? []).map(canonicalInstance),
  }));
  return { contractId: contract.contractId, contractVersion: contract.contractVersion, pages };
}

/** Convert a scene object's editor-pixel geometry into normalized contract geometry. */
export function pixelToNormalizedGeometry(
  geo: SceneGeometry,
  roleId: string,
  base: ShellDefaultPresentation['geometry'],
): ShellDefaultPresentation['geometry'] {
  const anchor = anchorFor(roleId);
  const offset = {
    x: geo.x / CANVAS.width - anchor.x,
    y: geo.y / CANVAS.height - anchor.y,
  };
  // Size is only overlaid when the scene carries an explicit display size;
  // otherwise the canonical size is kept (Text objects author position, not size).
  const size =
    geo.width !== null && geo.height !== null
      ? {
          width: (geo.width * geo.scaleX) / CANVAS.width,
          height: (geo.height * geo.scaleY) / CANVAS.height,
        }
      : base.size;
  return { offset, size, fit: base.fit };
}

/** Overlay a single scene object's authored presentation onto the prototype base. */
function overlayPresentation(
  obj: SemanticObject,
  proto: ShellInstanceDefinition<ShellStateIdV2>,
  catalogIndex: Map<string, ReturnType<Catalog['entries']['at']>>,
): ShellDefaultPresentation {
  const base = proto.defaultPresentation;
  const roleDef = roleOf(proto.roleId);
  const editable = new Set(roleDef?.editableProperties ?? []);
  const presentation: ShellDefaultPresentation = {
    geometry: editable.has('geometry')
      ? pixelToNormalizedGeometry(obj.geometry, proto.roleId, base.geometry)
      : base.geometry,
    order: base.order,
    visibility: obj.visible ? 'visible' : 'hidden',
  };
  if (editable.has('copy') && typeof obj.copy === 'string') {
    presentation.copy = obj.copy;
  } else if (base.copy !== undefined) {
    presentation.copy = base.copy;
  }
  if (editable.has('assetId')) {
    const assetId = resolveAssetId(obj, catalogIndex);
    if (assetId) presentation.assetId = assetId;
    else if (base.assetId !== undefined) presentation.assetId = base.assetId;
  } else if (base.assetId !== undefined) {
    presentation.assetId = base.assetId;
  }
  if (editable.has('colors')) {
    const colors = resolveColors(obj);
    if (colors) presentation.colors = colors;
    else if (base.colors !== undefined) presentation.colors = base.colors;
  } else if (base.colors !== undefined) {
    presentation.colors = base.colors;
  }
  return presentation;
}

/** Resolve a scene object's asset id from an `asset:<id>` binding or a texture key. */
function resolveAssetId(
  obj: SemanticObject,
  catalogIndex: Map<string, ReturnType<Catalog['entries']['at']>>,
): string | undefined {
  const binding = obj.carrier.fabBinding;
  const m = /^asset:(.+)$/.exec(binding);
  if (m && catalogIndex.has(m[1])) return m[1];
  if (obj.textureKey) {
    for (const [id, entry] of catalogIndex) {
      if (entry && entry.packKey === obj.textureKey) return id;
    }
  }
  return undefined;
}

/**
 * Read a per-object color (Text `color` / `tint` / `fillColor`) as a #RRGGBB
 * overlay on the `foreground` channel — the Phaser lane's explicit per-object
 * color (there is no shared-palette model; card comment 15 §12).
 */
function resolveColors(obj: SemanticObject): Record<string, string> | undefined {
  const raw = obj.color;
  if (raw === null) return undefined;
  const hex =
    typeof raw === 'number'
      ? `#${(raw & 0xffffff).toString(16).padStart(6, '0')}`
      : raw;
  if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return { foreground: hex.toLowerCase() };
  return undefined;
}

/** An extraction issue that could not be resolved to a valid instance. */
export interface ExtractionIssue {
  scene: string;
  object: string;
  code: string;
  detail: string;
}

export interface ExtractionResult {
  document: ShellPresentationDocumentV2;
  issues: ExtractionIssue[];
}

/**
 * Extract a `ShellPresentationDocumentV2` from a scene set (state → scene doc).
 * Starts from the canonical baseline so every required instance is present, then
 * overlays each authored scene object's editable presentation. Objects whose
 * `fabSemanticId` is not a known prototype are reported as issues (not silently
 * dropped) so validate.ts can block them.
 */
export function extractDocument(
  sceneByState: ReadonlyMap<ShellStateIdV2, SceneDoc>,
  catalog: Catalog,
): ExtractionResult {
  const catalogIndex = indexById(catalog) as unknown as Map<
    string,
    ReturnType<Catalog['entries']['at']>
  >;
  const issues: ExtractionIssue[] = [];
  const pages: ShellPresentationPage<ShellStateIdV2>[] = contract.states.map((state) => {
    const scene = sceneByState.get(state.id);
    const canonical = new Map(
      (instancesByState.get(state.id) ?? []).map((proto) => [proto.id, canonicalInstance(proto)]),
    );
    if (scene) {
      // Group scene objects by their carrier id; the base object is the one whose
      // variant is empty/"default", variant objects overlay onto their key.
      const groups = new Map<string, SemanticObject[]>();
      for (const obj of scene.objects) {
        const id = obj.carrier.fabSemanticId;
        (groups.get(id) ?? groups.set(id, []).get(id)!).push(obj);
      }
      for (const [id, objects] of groups) {
        const proto = prototype(id);
        if (!proto || proto.stateId !== state.id) {
          issues.push({
            scene: scene.sceneKey,
            object: objects[0]?.label ?? id,
            code: 'unknown-prototype',
            detail: `carrier "${id}" is not a ${state.id} prototype`,
          });
          continue;
        }
        const base =
          objects.find((o) => o.carrier.fabVariant === '' || o.carrier.fabVariant === 'default') ??
          objects[0];
        const instance = canonical.get(id)!;
        instance.presentation = overlayPresentation(base, proto, catalogIndex);
      }
    }
    return {
      stateId: state.id,
      editorPageId: state.editorPageId,
      instances: [...canonical.values()],
    };
  });
  return {
    document: { contractId: contract.contractId, contractVersion: contract.contractVersion, pages },
    issues,
  };
}

/** The canonical editor page id for a state (used when writing scaffolding scenes). */
export function editorPageId(stateId: ShellStateIdV2): string {
  return statesById.get(stateId)?.editorPageId ?? stateId;
}

/** The ordered canonical state ids. */
export const STATE_IDS: readonly ShellStateIdV2[] = contract.states.map((s) => s.id);
