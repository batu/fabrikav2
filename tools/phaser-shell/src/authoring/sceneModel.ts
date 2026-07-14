// Shared, read-only walk of a Phaser Editor `.scene` document (U5, KTD-A).
//
// A `.scene` file is the Phaser Editor scene-editor JSON: a `settings` block
// (canvas size, scene key) plus a `displayList` tree of game objects. Objects
// may nest through a `list` field (Containers). This module is the SINGLE walk
// shared by validate.ts (typed block codes) and publish/extract — neither
// re-implements the traversal. It NEVER mutates the input.
import {
  SEMANTIC_COMPONENT,
  hasSemanticComponent,
  readCarrier,
} from './semantic.ts';
import type { SemanticCarrier } from './semantic.ts';

/** Per-object geometry lifted from the raw scene object (editor pixel space). */
export interface SceneGeometry {
  x: number;
  y: number;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
  /** Explicit display size when the editor recorded one (Images/NineSlice). */
  width: number | null;
  height: number | null;
}

/** A scene object that declares the `Semantic` component, lifted into a flat record. */
export interface SemanticObject {
  /** The editor object UUID (fresh per object; the R8 duplicate-identity anchor). */
  uuid: string;
  /** The editor label (human-facing; used in block messages). */
  label: string;
  /** Phaser object type (Text/Image/Container/…). */
  type: string;
  carrier: SemanticCarrier;
  geometry: SceneGeometry;
  /** Texture pack key when the object renders a raster, else null. */
  textureKey: string | null;
  /** Editable copy string (Text objects), else null. */
  copy: string | null;
  /** Per-object color as an editor value (tint/fillColor/color), else null. */
  color: number | string | null;
  visible: boolean;
  /** Display-list order within the parent (0-based index; stable). */
  order: number;
  /** The parent semantic object's uuid, or null at the scene root. */
  parentUuid: string | null;
  /** The raw object, for guards that inspect arbitrary properties (safety.ts). */
  raw: Record<string, unknown>;
}

/** A parsed scene document. */
export interface SceneDoc {
  sceneKey: string;
  borderWidth: number;
  borderHeight: number;
  /** Every semantic object in display order, parents before children. */
  objects: SemanticObject[];
  /** The raw document, for whole-file guards. */
  raw: Record<string, unknown>;
}

/** One raw display-list object, keyed by its canonical tree address. */
export interface SceneCreationFact {
  path: string;
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  textureKey: string | null;
  /** Editable copy string (Text objects), else null. */
  copy: string | null;
  /** Per-object color as an editor value (tint/fillColor/color), else null. */
  color: number | string | null;
  visible: boolean;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readColor(obj: Record<string, unknown>): number | string | null {
  for (const field of ['tint', 'fillColor', 'color'] as const) {
    const value = obj[field];
    if (typeof value === 'number' || typeof value === 'string') return value;
  }
  return null;
}

function readGeometry(obj: Record<string, unknown>): SceneGeometry {
  // Phaser Editor omits type defaults when it saves. Text-like objects default
  // to top-left origin (0,0); Images and Containers default to center (0.5,0.5).
  // Treating every omission as center makes Editor-normalized Text drift from
  // its generated `setOrigin` facts.
  const defaultOrigin = obj['type'] === 'Text' || obj['type'] === 'BitmapText' ? 0 : 0.5;
  return {
    x: num(obj['x'], 0),
    y: num(obj['y'], 0),
    originX: num(obj['originX'], defaultOrigin),
    originY: num(obj['originY'], defaultOrigin),
    scaleX: num(obj['scaleX'], 1),
    scaleY: num(obj['scaleY'], 1),
    width: typeof obj['width'] === 'number' ? obj['width'] : null,
    height: typeof obj['height'] === 'number' ? obj['height'] : null,
  };
}

/**
 * Walk the raw display list depth-first, yielding every object that declares
 * the `Semantic` component with its parent linkage and sibling order. Objects
 * without the component are still traversed (so nested semantic children are
 * reached) but are not emitted.
 */
function walk(
  list: unknown,
  parentUuid: string | null,
  out: SemanticObject[],
): void {
  if (!Array.isArray(list)) return;
  list.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object') return;
    const obj = entry as Record<string, unknown>;
    const uuid = typeof obj['id'] === 'string' ? obj['id'] : '';
    let emittedUuid = parentUuid;
    if (hasSemanticComponent(obj)) {
      const semantic: SemanticObject = {
        uuid,
        label: typeof obj['label'] === 'string' ? obj['label'] : uuid,
        type: typeof obj['type'] === 'string' ? obj['type'] : 'unknown',
        carrier: readCarrier(obj),
        geometry: readGeometry(obj),
        textureKey:
          obj['texture'] && typeof obj['texture'] === 'object'
            ? ((obj['texture'] as Record<string, unknown>)['key'] as string) ?? null
            : null,
        copy: typeof obj['text'] === 'string' ? obj['text'] : null,
        color: readColor(obj),
        visible: obj['visible'] === false ? false : true,
        order: index,
        parentUuid,
        raw: obj,
      };
      out.push(semantic);
      emittedUuid = uuid;
    }
    // Recurse into Container children regardless of the parent's own component.
    walk(obj['list'], emittedUuid, out);
  });
}

/** Parse a raw `.scene` document object into the shared scene model. */
export function parseSceneDoc(raw: unknown): SceneDoc {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('scene document must be an object');
  }
  const doc = raw as Record<string, unknown>;
  const settings = (doc['settings'] as Record<string, unknown>) ?? {};
  const objects: SemanticObject[] = [];
  walk(doc['displayList'], null, objects);
  return {
    sceneKey: typeof settings['sceneKey'] === 'string' ? settings['sceneKey'] : '',
    borderWidth: num(settings['borderWidth'], 0),
    borderHeight: num(settings['borderHeight'], 0),
    objects,
    raw: doc,
  };
}

/** Every display object (semantic or companion), preserving parent and sibling order. */
export function sceneCreationFacts(doc: SceneDoc): Map<string, SceneCreationFact> {
  const out = new Map<string, SceneCreationFact>();
  const visit = (list: unknown, parentPath: string | null): void => {
    if (!Array.isArray(list)) return;
    list.forEach((entry, order) => {
      if (entry === null || typeof entry !== 'object') return;
      const raw = entry as Record<string, unknown>;
      const treePath = parentPath === null ? `${order}` : `${parentPath}/${order}`;
      const geometry = readGeometry(raw);
      const texture = raw['texture'];
      const textureKey = texture && typeof texture === 'object'
        && typeof (texture as Record<string, unknown>)['key'] === 'string'
        ? String((texture as Record<string, unknown>)['key'])
        : null;
      out.set(treePath, {
        path: treePath,
        id: typeof raw['id'] === 'string' ? raw['id'] : '',
        label: typeof raw['label'] === 'string' ? raw['label'] : treePath,
        type: typeof raw['type'] === 'string' ? raw['type'] : 'unknown',
        x: geometry.x,
        y: geometry.y,
        textureKey,
        copy: typeof raw['text'] === 'string' ? raw['text'] : null,
        color: readColor(raw),
        visible: raw['visible'] === false ? false : true,
      });
      visit(raw['list'], treePath);
    });
  };
  visit(doc.raw['displayList'], null);
  return out;
}

/**
 * The duplicate-detection key for a semantic object: identity + variant. Two
 * objects sharing this key are the R8 pre-retarget clone — a fresh object UUID
 * but a cloned `fabSemanticId` — which publication must block until retargeted.
 */
export function carrierKey(obj: SemanticObject): string {
  return `${obj.carrier.fabSemanticId}\u0000${obj.carrier.fabVariant}`;
}

/**
 * Return the `fabSemanticId` values that appear more than once at the same
 * variant across a scene — the cloned-identity duplicates. The object UUIDs are
 * distinct (fresh per object); only the carrier identity is cloned.
 */
export function findDuplicateSemanticIds(doc: SceneDoc): string[] {
  const seen = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const obj of doc.objects) {
    if (!obj.carrier.fabSemanticId) continue;
    const key = carrierKey(obj);
    if (seen.has(key)) duplicates.add(obj.carrier.fabSemanticId);
    else seen.set(key, obj.uuid);
  }
  return [...duplicates];
}

/** True when the raw object anywhere in the tree declares the `Semantic` component. */
export { SEMANTIC_COMPONENT };
