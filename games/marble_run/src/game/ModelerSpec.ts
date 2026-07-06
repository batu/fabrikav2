import * as THREE from 'three';

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

export interface ModelerSpecPart {
  readonly id?: string;
  readonly lathe?: {
    readonly profile: readonly Vec2[];
    readonly segments?: number;
  };
  readonly prim?: 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'plane';
  readonly dims?: Record<string, number>;
  readonly cell?: Vec2;
  readonly on?: string;
  readonly anchor?: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';
  readonly offset?: Vec2;
  readonly pos?: Vec3;
  readonly scale?: number | Vec3;
  readonly swatch?: string | number;
}

export interface ModelerSpec {
  readonly palette?: readonly string[];
  readonly parts: readonly ModelerSpecPart[];
}

export interface ModelerRenderOptions {
  readonly colorOverride?: number;
  readonly colorSwatch?: string;
  readonly materialForPart?: (
    part: ModelerSpecPart,
    color: THREE.Color,
  ) => THREE.Material;
}

interface ResolvedPart {
  readonly id: string;
  readonly spec: ModelerSpecPart;
  readonly mesh: THREE.Mesh;
  readonly box: THREE.Box3;
}

const MODELER_CELL = 0.5;

export function buildModelerSpec(spec: ModelerSpec, options: ModelerRenderOptions = {}): THREE.Group {
  const group = new THREE.Group();
  group.userData.modelerSpec = true;
  const resolved = new Map<string, ResolvedPart>();

  spec.parts.forEach((part, index) => {
    const id = part.id ?? `part${index}`;
    const geometry = geometryForPart(part);
    const color = colorForPart(spec, part, options);
    const material =
      options.materialForPart?.(part, color) ??
      new THREE.MeshStandardMaterial({
        color,
        roughness: part.id?.includes('gloss') ? 0.18 : 0.72,
        metalness: 0,
      });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = id;
    mesh.userData.modelerPartId = id;
    mesh.userData.modelerSwatch = part.swatch;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const scale = scaleVector(part.scale);
    mesh.scale.copy(scale);
    mesh.updateMatrixWorld(true);
    const scaledBox = new THREE.Box3().setFromObject(mesh);
    const translatedBox = scaledBox.clone();

    const translation = placementForPart(part, scaledBox, resolved);
    mesh.position.copy(translation);
    translatedBox.translate(translation);

    group.add(mesh);
    resolved.set(id, { id, spec: part, mesh, box: translatedBox });
  });

  return group;
}

export function findModelerMesh(root: THREE.Object3D, id: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((object) => {
    if (found) return;
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.userData.modelerPartId === id) found = mesh;
  });
  return found;
}

export function modelerMeshesBySwatch(root: THREE.Object3D, swatch: string): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.userData.modelerSwatch === swatch) meshes.push(mesh);
  });
  return meshes;
}

function geometryForPart(part: ModelerSpecPart): THREE.BufferGeometry {
  if (part.lathe) {
    const points = part.lathe.profile.map(([radius, y]) => new THREE.Vector2(Math.max(0, radius), y));
    const geometry = new THREE.LatheGeometry(points, part.lathe.segments ?? 24);
    geometry.computeVertexNormals();
    return geometry;
  }

  const dims = part.dims ?? {};
  switch (part.prim) {
    case 'box':
      return new THREE.BoxGeometry(dims.x ?? 1, dims.y ?? 1, dims.z ?? 1);
    case 'cylinder':
      return new THREE.CylinderGeometry(
        dims.radiusTop ?? dims.radius ?? 0.5,
        dims.radiusBottom ?? dims.radius ?? 0.5,
        dims.height ?? 1,
        dims.segments ?? 24,
      );
    case 'sphere':
      return new THREE.SphereGeometry(dims.radius ?? 0.5, 24, 16);
    case 'cone':
      return new THREE.ConeGeometry(dims.radius ?? 0.5, dims.height ?? 1, dims.segments ?? 24);
    case 'torus':
      return new THREE.TorusGeometry(dims.radius ?? 0.5, dims.tube ?? 0.15, 12, 32);
    case 'plane':
      return new THREE.PlaneGeometry(dims.x ?? 1, dims.y ?? 1);
    default:
      throw new Error(`Unsupported modeler part source for "${part.id ?? 'unnamed'}"`);
  }
}

function placementForPart(
  part: ModelerSpecPart,
  box: THREE.Box3,
  resolved: Map<string, ResolvedPart>,
): THREE.Vector3 {
  const center = box.getCenter(new THREE.Vector3());
  if (part.cell) {
    return new THREE.Vector3(part.cell[0] * MODELER_CELL - center.x, -box.min.y, part.cell[1] * MODELER_CELL - center.z);
  }
  if (part.pos) {
    return new THREE.Vector3(part.pos[0] - center.x, part.pos[1] - box.min.y, part.pos[2] - center.z);
  }
  if (!part.on) {
    throw new Error(`Modeler part "${part.id ?? 'unnamed'}" has no supported placement`);
  }
  const target = resolved.get(part.on);
  if (!target) throw new Error(`Modeler part "${part.id ?? 'unnamed'}" references missing part "${part.on}"`);
  const targetCenter = target.box.getCenter(new THREE.Vector3());
  const [offsetX, offsetZ] = part.offset ?? [0, 0];

  switch (part.anchor ?? 'top') {
    case 'top':
      return new THREE.Vector3(targetCenter.x + offsetX - center.x, target.box.max.y - box.min.y, targetCenter.z + offsetZ - center.z);
    case 'bottom':
      return new THREE.Vector3(targetCenter.x + offsetX - center.x, target.box.min.y - box.max.y, targetCenter.z + offsetZ - center.z);
    case 'front':
      return new THREE.Vector3(targetCenter.x + offsetX - center.x, targetCenter.y - center.y, target.box.max.z - box.min.z);
    case 'back':
      return new THREE.Vector3(targetCenter.x + offsetX - center.x, targetCenter.y - center.y, target.box.min.z - box.max.z);
    case 'left':
      return new THREE.Vector3(target.box.min.x - box.max.x, targetCenter.y - center.y, targetCenter.z + offsetX - center.z);
    case 'right':
      return new THREE.Vector3(target.box.max.x - box.min.x, targetCenter.y - center.y, targetCenter.z + offsetX - center.z);
    default:
      throw new Error(`Unsupported modeler anchor "${part.anchor}"`);
  }
}

function colorForPart(
  spec: ModelerSpec,
  part: ModelerSpecPart,
  options: ModelerRenderOptions,
): THREE.Color {
  const ref = part.swatch;
  if (options.colorOverride !== undefined && ref === (options.colorSwatch ?? 'P5')) {
    return new THREE.Color(options.colorOverride);
  }
  if (typeof ref === 'string' && /^P\d+$/i.test(ref)) {
    const index = Number(ref.slice(1));
    const hex = spec.palette?.[index] ?? '#cccccc';
    return new THREE.Color(hex);
  }
  if (typeof ref === 'number') {
    return new THREE.Color(spec.palette?.[ref] ?? '#cccccc');
  }
  if (typeof ref === 'string' && /^#[0-9a-f]{6}$/i.test(ref)) {
    return new THREE.Color(ref);
  }
  return new THREE.Color('#cccccc');
}

function scaleVector(scale: number | Vec3 | undefined): THREE.Vector3 {
  if (typeof scale === 'number') return new THREE.Vector3(scale, scale, scale);
  if (scale) return new THREE.Vector3(scale[0], scale[1], scale[2]);
  return new THREE.Vector3(1, 1, 1);
}
