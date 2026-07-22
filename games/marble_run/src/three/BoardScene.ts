/**
 * Three.js dimetric board: wooden tray, dimples, gate pockets, glossy
 * marble spheres. Renders one BoardEngine level and animates TapChange
 * descriptors with v3-style feel (squash, bounce, jelly energy).
 *
 * Engine state stays IDs-only; mesh maps live here.
 */
import * as THREE from 'three';
import { COLORS3D, W3D } from './constants';
import type { BoardEngine } from '../marble-board';
import {
  gateMouthCell,
  type Cell,
  type GateDef,
  type MarbleColor,
  type MarbleRoutePreview,
  type TapChange,
} from '../marble-board';
import { rollTic, setRollingActive, spawnTick } from '../audio/Sfx';
import boardTraySpec from './specs/sugar3d-board-tray.json';
import edgeGateSpec from './specs/sugar3d-edge-gate.json';
import marbleCoreSpec from './specs/sugar3d-marble-core.json';
import plugCapSpec from './specs/sugar3d-plug-cap.json';
import {
  buildModelerSpec,
  findModelerMesh,
  modelerMeshesBySwatch,
  type ModelerSpec,
  type ModelerSpecPart,
} from './ModelerSpec';

const BOARD_TRAY_SPEC = boardTraySpec as unknown as ModelerSpec;
const EDGE_GATE_SPEC = edgeGateSpec as unknown as ModelerSpec;
const MARBLE_CORE_SPEC = marbleCoreSpec as unknown as ModelerSpec;
const PLUG_CAP_SPEC = plugCapSpec as unknown as ModelerSpec;
const MISTAKE_FEEDBACK_S = 0.56;
const MISTAKE_FEEDBACK_MS = MISTAKE_FEEDBACK_S * 1000;
const BLOCKED_PLUG_MARK_GEO = new THREE.BoxGeometry(0.62, 0.052, 0.13);
const BLOCKED_PLUG_MARK_SHADOW_GEO = new THREE.BoxGeometry(0.68, 0.034, 0.17);
const BLOCKED_PLUG_MARK_MAT = new THREE.MeshStandardMaterial({
  color: 0xff4d6d,
  roughness: 0.26,
  metalness: 0,
  emissive: new THREE.Color(0xff4d6d).multiplyScalar(0.1),
});
const BLOCKED_PLUG_MARK_SHADOW_MAT = new THREE.MeshStandardMaterial({
  color: 0x203040,
  roughness: 0.48,
  metalness: 0,
});

export interface BoardCallbacks {
  onAbsorbed: (change: Extract<TapChange, { kind: 'rolled' }>) => void;
  onBlockedImpact: (change: Extract<TapChange, { kind: 'blocked' }>) => void;
}

interface MarbleNode {
  readonly group: THREE.Group;
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh;
}

interface RollAnim {
  readonly node: MarbleNode;
  readonly points: THREE.Vector3[];
  readonly segLens: number[];
  readonly totalLen: number;
  readonly change: Extract<TapChange, { kind: 'rolled' }>;
  t: number;
  lastTic: number;
  trailT: number;
}

interface BlockedRollAnim {
  readonly node: MarbleNode;
  readonly points: THREE.Vector3[];
  readonly segLens: number[];
  readonly totalLen: number;
  readonly change: Extract<TapChange, { kind: 'blocked' }>;
  readonly color: MarbleColor;
  readonly blockerId: number | null;
  t: number;
  returning: boolean;
  trailT: number;
}

interface BlockedPathNode {
  readonly cell: Cell;
  readonly dir: number;
  readonly cost: number;
  readonly prev: BlockedPathNode | null;
}

interface PathNodeWithBlockers {
  readonly cell: Cell;
  readonly dir: number;
  readonly cost: number;
  readonly blockers: number;
  readonly prev: PathNodeWithBlockers | null;
}

interface SpawnAnim {
  readonly node: MarbleNode;
  readonly targetY: number;
  readonly delay: number;
  t: number;
  index: number;
  ticked: boolean;
}

interface GateShard {
  readonly mesh: THREE.Mesh;
  readonly vel: THREE.Vector3;
  readonly spin: THREE.Vector3;
  t: number;
  readonly life: number;
}

export class BoardScene {
  readonly root = new THREE.Group();
  private readonly engine: BoardEngine;
  private readonly callbacks: BoardCallbacks;
  private readonly marbles = new Map<number, MarbleNode>();
  private readonly gates = new Map<string, THREE.Group>();
  private rolls: RollAnim[] = [];
  private blockedRolls: BlockedRollAnim[] = [];
  private spawns: SpawnAnim[] = [];
  private wobbles: Array<{ mesh: THREE.Object3D; t: number }> = [];
  private sparks: Array<{ pts: THREE.Points; vel: THREE.Vector3[]; t: number }> = [];
  private trailRibbons: Array<{ mesh: THREE.Mesh; t: number; life: number }> = [];
  /** Halves the ghost-afterimage emit cadence (see emitGhost). */
  private ghostToggle = false;
  private impactRings: Array<{ mesh: THREE.Mesh; t: number; life: number }> = [];
  private collectRings: Array<{ mesh: THREE.Mesh; t: number; life: number; maxScale: number; opacity: number }> = [];
  private collectBursts: Array<{ pts: THREE.Points; vel: THREE.Vector3[]; t: number; life: number }> = [];
  private hints: Array<{ mesh: THREE.Mesh; t: number }> = [];
  private routePreview: THREE.Group | null = null;
  private routePreviewT = 0;
  private breakingGates: Array<{ gate: THREE.Group; t: number }> = [];
  private gateShards: GateShard[] = [];
  private rollingSoundActive = false;
  private mistakeFeedbackT = 0;
  private mistakeFeedbackTimer: number | null = null;
  private animationSpeedMultiplier = 1;

  private entryT = 0;

  constructor(engine: BoardEngine, callbacks: BoardCallbacks) {
    this.engine = engine;
    this.callbacks = callbacks;
    this.buildTray();
    this.buildGates();
    this.spawnMarbles();
    // Entry: the tray settles up into place as the marbles start raining.
    this.root.position.y = -0.55;
    this.root.scale.setScalar(0.94);
  }

  /** Grid cell → world position (board centered at origin, y=0 = tray top). */
  cellToWorld(cell: Cell, y = 0): THREE.Vector3 {
    return new THREE.Vector3(
      (cell.x - (this.engine.cols - 1) / 2) * W3D.CELL,
      y,
      (cell.y - (this.engine.rows - 1) / 2) * W3D.CELL,
    );
  }

  worldToCell(p: THREE.Vector3): Cell | null {
    const x = Math.round(p.x / W3D.CELL + (this.engine.cols - 1) / 2);
    const y = Math.round(p.z / W3D.CELL + (this.engine.rows - 1) / 2);
    if (x < 0 || y < 0 || x >= this.engine.cols || y >= this.engine.rows) return null;
    return { x, y };
  }

  /** Pity hint: emissive pulse on the marble at `cell`. */
  pulseHint(cell: Cell): void {
    for (const [id, node] of this.marbles) {
      const m = this.engine.marbleAt(cell);
      if (m && m.id === id) {
        this.hints.push({ mesh: node.mesh, t: 0 });
        return;
      }
    }
  }

  showRoutePreview(preview: MarbleRoutePreview): void {
    this.clearRoutePreview();
    this.pulseHint(preview.cell);

    const y = 0.25;
    const routePoints = preview.path.map((cell) => this.cellToWorld(cell, y));
    const gatePos = this.gateWorld(preview.gate);
    routePoints.push(new THREE.Vector3(gatePos.x, y, gatePos.z));

    this.showRoutePoints(routePoints, COLORS3D.marble[preview.color]);
  }

  showBlockedRoutePreview(cell: Cell): boolean {
    const marble = this.engine.marbleAt(cell);
    if (!marble) return false;
    this.clearRoutePreview();
    this.pulseHint(cell);

    const route = this.blockedRoute({
      kind: 'blocked',
      marbleId: marble.id,
      color: marble.color,
      cell: marble.cell,
      heartsLeft: this.engine.hearts(),
      failed: false,
    });
    if (route.points.length < 2) return false;

    this.showRoutePoints(route.points.map((point) => new THREE.Vector3(point.x, 0.25, point.z)), COLORS3D.marble[marble.color]);
    return true;
  }

  private showRoutePoints(routePoints: THREE.Vector3[], color: number): void {
    const group = new THREE.Group();
    this.routePreviewT = 0;

    const lineGeo = new THREE.BufferGeometry().setFromPoints(routePoints);
    const line = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.88,
      }),
    );
    line.userData.routeKind = 'line';
    group.add(line);

    const beamGeo = new THREE.CylinderGeometry(0.055, 0.055, 1, 12);
    routePoints.slice(0, -1).forEach((point, index) => {
      const next = routePoints[index + 1];
      const dir = next.clone().sub(point);
      const len = dir.length();
      if (len <= 0.001) return;
      const beam = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({
          color: index % 2 === 0 ? 0xffffff : color,
          transparent: true,
          opacity: 0.78,
          depthWrite: false,
        }),
      );
      beam.position.copy(point).lerp(next, 0.5);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      beam.scale.y = len;
      beam.userData.routeKind = 'beam';
      beam.userData.phase = index * 0.42;
      group.add(beam);
    });

    const markerGeo = new THREE.TorusGeometry(W3D.DIMPLE_R * 0.34, 0.026, 8, 24);
    const markerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.86,
    });
    routePoints.forEach((point, index) => {
      const marker = new THREE.Mesh(markerGeo, markerMat.clone());
      marker.position.copy(point);
      marker.rotation.x = Math.PI / 2;
      const s = index === routePoints.length - 1 ? 1.35 : 1;
      marker.scale.setScalar(s);
      marker.userData.routeKind = 'marker';
      marker.userData.baseScale = s;
      marker.userData.phase = index * 0.42;
      group.add(marker);
    });

    const glowGeo = new THREE.SphereGeometry(W3D.MARBLE_R * 0.44, 16, 10);
    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.72,
    });
    routePoints.forEach((point, index) => {
      const dot = new THREE.Mesh(glowGeo, glowMat.clone());
      dot.position.copy(point);
      dot.userData.routeKind = 'dot';
      dot.userData.baseScale = 1;
      dot.userData.phase = index * 0.42 + 0.2;
      group.add(dot);
    });

    this.root.add(group);
    this.routePreview = group;
  }

  clearRoutePreview(): void {
    if (!this.routePreview) return;
    this.root.remove(this.routePreview);
    disposeObject(this.routePreview);
    this.routePreview = null;
    this.routePreviewT = 0;
  }

  hasRoutePreview(): boolean {
    return this.routePreview !== null;
  }

  activeGateColors(): MarbleColor[] {
    return [...this.gates.values()].map((gate) => (gate.userData as { color: MarbleColor }).color);
  }

  activeGatePrimaryHexes(): Record<string, string> {
    const colors: Record<string, string> = {};
    for (const [key, gate] of this.gates) {
      const mesh = this.gatePrimaryMeshes(gate)[0];
      if (!mesh) continue;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      colors[key] = mat.color.getHexString();
    }
    return colors;
  }

  /** Static marble meshes for precise tap picking. */
  marbleMeshes(): THREE.Object3D[] {
    return [...this.marbles.values()].flatMap((node) => {
      const meshes: THREE.Object3D[] = [];
      node.group.traverse((object) => {
        if (object instanceof THREE.Mesh) meshes.push(object);
      });
      return meshes;
    });
  }

  /** Cell of a marble by id (engine truth). */
  cellOfMarble(id: number): Cell | null {
    const m = this.engine.allMarbles().find((x) => x.id === id);
    return m ? m.cell : null;
  }

  isAnimating(): boolean {
    return this.rolls.length > 0 || this.blockedRolls.length > 0;
  }

  isSpawningMarbles(): boolean {
    return this.spawns.length > 0;
  }

  isBlockedMarbleAnimating(id: number): boolean {
    return this.blockedRolls.some((roll) => roll.change.marbleId === id);
  }

  setAnimationSpeed(multiplier: number): void {
    this.animationSpeedMultiplier = Math.min(Math.max(multiplier, 0.1), 8);
  }

  boardSize(): { w: number; d: number } {
    return {
      w: this.engine.cols * W3D.CELL + W3D.TRAY_PAD * 2,
      d: this.engine.rows * W3D.CELL + W3D.TRAY_PAD * 2,
    };
  }

  // ── Static build ─────────────────────────────────────────────────

  private buildTray(): void {
    const { w, d } = this.boardSize();
    const woodMap = woodTexture();
    woodMap.repeat.set(2.4, 2.4);

    const tray = buildModelerSpec(BOARD_TRAY_SPEC, {
      materialForPart: (part, color) => {
        const id = part.id ?? '';
        if (id === 'play-recess') {
          return new THREE.MeshStandardMaterial({
            color: BOARD_SURFACE,
            map: softPanelTexture(),
            roughness: 0.58,
          });
        }
        if (id.includes('highlight')) {
          return new THREE.MeshStandardMaterial({
            color,
            roughness: 0.34,
            metalness: 0,
            emissive: color.clone().multiplyScalar(0.08),
          });
        }
        return new THREE.MeshStandardMaterial({
          color: id === 'tray-body' ? COLORS3D.woodSide : COLORS3D.woodRim,
          map: woodMap,
          roughness: id === 'tray-body' ? 0.62 : 0.5,
          metalness: 0,
        });
      },
    });
    tray.position.y = -W3D.TRAY_DEPTH;
    tray.scale.set(w / 6.7, 1, d / 6.7);
    this.root.add(tray);

    for (let y = 0; y < this.engine.rows; y += 1) {
      for (let x = 0; x < this.engine.cols; x += 1) {
        const content = this.engine.contentAt({ x, y });
        if (content.kind === 'void') {
          // Void cells are gameplay-equivalent to plugs (marbles can never
          // enter either) but bare surface reads as confusing dead space —
          // show the blocked-tile cap so the two look the same.
          this.root.add(this.buildBlockedPlug({ x, y }));
          continue;
        }
        if (content.kind === 'plug') {
          this.root.add(this.buildBlockedPlug({ x, y }));
          continue;
        }
        const cellMarker = this.buildCellMarker();
        cellMarker.position.copy(this.cellToWorld({ x, y }, 0.095));
        this.root.add(cellMarker);
      }
    }
  }

  private buildBlockedPlug(cell: Cell): THREE.Group {
    const group = new THREE.Group();
    const plug = buildModelerSpec(PLUG_CAP_SPEC, {
      materialForPart: plugMaterial,
    });
    plug.position.copy(this.cellToWorld(cell, 0.1));
    plug.scale.set(0.92, 0.72, 0.92);
    group.add(plug);

    const marker = new THREE.Group();
    marker.position.copy(this.cellToWorld(cell, 0.448));
    for (const rotation of [Math.PI / 4, -Math.PI / 4]) {
      const shadow = new THREE.Mesh(BLOCKED_PLUG_MARK_SHADOW_GEO, BLOCKED_PLUG_MARK_SHADOW_MAT);
      shadow.rotation.y = rotation;
      shadow.castShadow = true;
      shadow.receiveShadow = true;
      shadow.position.y = -0.017;
      marker.add(shadow);

      const bar = new THREE.Mesh(BLOCKED_PLUG_MARK_GEO, BLOCKED_PLUG_MARK_MAT);
      bar.rotation.y = rotation;
      bar.castShadow = true;
      bar.receiveShadow = true;
      marker.add(bar);
    }
    group.add(marker);

    return group;
  }

  private buildGates(): void {
    for (const gate of this.engine.level.gates) {
      const g = this.buildGate(gate);
      this.root.add(g);
      this.gates.set(gateKey(gate), g);
    }
  }

  gateWorld(gate: GateDef): THREE.Vector3 {
    const mouth = gateMouthCell(gate, this.engine.cols, this.engine.rows);
    const out = this.cellToWorld(mouth, 0.16);
    const off = W3D.CELL * 0.5 + W3D.TRAY_PAD * 0.45;
    if (gate.side === 'top') out.z -= off;
    if (gate.side === 'bottom') out.z += off;
    if (gate.side === 'left') out.x -= off;
    if (gate.side === 'right') out.x += off;
    return out;
  }

  private buildGate(gate: GateDef): THREE.Group {
    const color = COLORS3D.marble[gate.color];
    const group = buildModelerSpec(EDGE_GATE_SPEC, {
      colorOverride: color,
      colorSwatch: 'P5',
      materialForPart: (part, partColor) => gateMaterial(part, partColor, color),
    });
    const pos = this.gateWorld(gate);
    group.position.set(pos.x, 0.03, pos.z);
    group.userData.color = gate.color;
    return group;
  }

  /** Keep surviving gates visually stable after board state changes. */
  refreshGateLiveness(): void {
    for (const gate of this.engine.level.gates) {
      const g = this.gates.get(gateKey(gate));
      if (!g) continue;
      if ((g.userData as { breaking?: boolean }).breaking) continue;
      const base = new THREE.Color(COLORS3D.marble[gate.color]);
      this.setGatePrimaryColor(g, base);
    }
  }

  private setGatePrimaryColor(gate: THREE.Group, color: THREE.Color): void {
    for (const mesh of modelerMeshesBySwatch(gate, 'P5')) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.copy(color);
      mat.emissive.copy(color).multiplyScalar(0.08);
    }
  }

  private gatePrimaryMeshes(gate: THREE.Group): THREE.Mesh[] {
    return modelerMeshesBySwatch(gate, 'P5');
  }

  /** Empty-cell marker: a small flat dot on the pale surface. */
  private buildCellMarker(): THREE.Object3D {
    const marker = new THREE.Mesh(cellDotGeometry(), cellDotMaterial());
    marker.rotation.x = -Math.PI / 2;
    // Local offset must survive the caller's position.copy — wrap in a group.
    marker.position.y = 0.065;
    const holder = new THREE.Group();
    holder.add(marker);
    return holder;
  }

  // ── Marbles ──────────────────────────────────────────────────────

  private makeMarble(id: number, color: MarbleColor, cell: Cell): MarbleNode {
    const group = buildModelerSpec(MARBLE_CORE_SPEC, {
      colorOverride: COLORS3D.marble[color],
      colorSwatch: 'P5',
      materialForPart: (part, partColor) => marbleMaterial(part, partColor, COLORS3D.marble[color]),
    });
    for (const child of group.children) child.position.y -= W3D.MARBLE_R;
    const mesh = findModelerMesh(group, 'core');
    if (!mesh) throw new Error('modeler marble spec missing core mesh');
    mesh.castShadow = true;
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.userData.marbleId = id;
    });
    mesh.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
    );

    // Soft fake contact shadow (cheap grounding).
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(W3D.MARBLE_R * 0.85, 20),
      new THREE.MeshBasicMaterial({ color: 0x4c2b4d, transparent: true, opacity: 0.24 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.165;

    const pos = this.cellToWorld(cell, 0.15 + W3D.MARBLE_R);
    group.position.copy(pos);
    shadow.position.x = pos.x;
    shadow.position.z = pos.z;
    this.root.add(group);
    this.root.add(shadow);
    const node: MarbleNode = { group, mesh, shadow };
    this.marbles.set(id, node);
    return node;
  }

  private spawnMarbles(): void {
    const list = [...this.engine.allMarbles()].sort(
      (a, b) => a.cell.y - b.cell.y || a.cell.x - b.cell.x,
    );
    list.forEach((m, i) => {
      const node = this.makeMarble(m.id, m.color, m.cell);
      const targetY = node.group.position.y;
      node.group.position.y = targetY + W3D.DROP_HEIGHT;
      node.mesh.visible = false;
      node.shadow.scale.setScalar(0.2);
      (node.shadow.material as THREE.MeshBasicMaterial).opacity = 0;
      this.spawns.push({
        node,
        targetY,
        delay: i * W3D.SPAWN_STAGGER_S,
        t: 0,
        index: i,
        ticked: false,
      });
    });
  }

  // ── Change animation ─────────────────────────────────────────────

  animateChange(change: TapChange): void {
    if (change.kind === 'rolled') this.animateRoll(change);
    else this.animateBlocked(change);
  }

  private animateRoll(change: Extract<TapChange, { kind: 'rolled' }>): void {
    const node = this.marbles.get(change.marbleId);
    if (!node) return;
    this.marbles.delete(change.marbleId);

    const y = 0.15 + W3D.MARBLE_R;
    const pts = change.path.map((c) => this.cellToWorld(c, y));
    const gatePos = this.gateWorld(change.gate);
    pts.push(new THREE.Vector3(gatePos.x, y, gatePos.z));

    const segLens: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const l = pts[i].distanceTo(pts[i - 1]);
      segLens.push(l);
      total += l;
    }

    // v3 anticipation squash.
    node.mesh.scale.set(1.18, 0.8, 1.18);
    this.wobbles.push({ mesh: node.mesh, t: 0 });

    this.rolls.push({
      node,
      points: pts,
      segLens,
      totalLen: Math.max(total, 0.0001),
      change,
      t: 0,
      lastTic: 0,
      trailT: 0,
    });
  }

  private animateBlocked(change: Extract<TapChange, { kind: 'blocked' }>): void {
    const node = this.marbles.get(change.marbleId);
    if (!node) return;
    const path = this.blockedRoute(change);
    if (path.points.length < 2) {
      this.wobbles.push({ mesh: node.mesh, t: 0.0001 });
      this.triggerMistakeFeedback(node.group.position, change.color, null);
      this.callbacks.onBlockedImpact(change);
      return;
    }

    node.mesh.scale.set(1.14, 0.86, 1.14);
    this.wobbles.push({ mesh: node.mesh, t: 0.0001 });
    this.blockedRolls.push({
      node,
      points: path.points,
      segLens: path.segLens,
      totalLen: Math.max(path.totalLen, 0.0001),
      change,
      color: change.color,
      blockerId: path.blockerId,
      t: 0,
      returning: false,
      trailT: 0,
    });
  }

  private blockedRoute(change: Extract<TapChange, { kind: 'blocked' }>): {
    points: THREE.Vector3[];
    segLens: number[];
    totalLen: number;
    blockerId: number | null;
  } {
    const cells = this.findBlockedCells(change);
    const y = 0.15 + W3D.MARBLE_R;
    const points = cells.map((cell) => this.cellToWorld(cell, y));
    let blockerId: number | null = null;

    const blockerIndex = this.firstBlockedMarbleIndex(cells, change.marbleId);
    if (blockerIndex !== -1) {
      const content = this.engine.contentAt(cells[blockerIndex]!);
      if (content.kind === 'marble') {
        blockerId = content.id;
        points.splice(blockerIndex + 1);
        const previous = points[Math.max(0, blockerIndex - 1)]!;
        const blocker = points[blockerIndex]!;
        const approach = previous.clone().sub(blocker).normalize();
        points[blockerIndex] = blocker.clone().addScaledVector(approach, W3D.MARBLE_R * 1.78);
      }
    }

    for (let i = 1; i < points.length; i += 1) {
      if (points[i]!.distanceTo(points[i - 1]!) >= 0.001) continue;
      points.splice(i, 1);
      i -= 1;
    }

    if (blockerId === null) {
      // Fallback for non-marble blockers: keep the older first-obstruction nudge.
      for (let i = 1; i < cells.length; i += 1) {
        const content = this.engine.contentAt(cells[i]!);
        if (content.kind === 'empty' || content.kind === 'marble') continue;
        points.splice(i + 1);
        break;
      }
    }

    if (points.length < 2) {
      const nudge = this.firstAvailableNudge(change.cell, y);
      if (nudge) points.push(nudge);
    }

    const segLens: number[] = [];
    let totalLen = 0;
    for (let i = 1; i < points.length; i += 1) {
      const len = points[i]!.distanceTo(points[i - 1]!);
      segLens.push(len);
      totalLen += len;
    }
    return { points, segLens, totalLen, blockerId };
  }

  private firstBlockedMarbleIndex(cells: Cell[], marbleId: number): number {
    for (let i = 1; i < cells.length; i += 1) {
      const content = this.engine.contentAt(cells[i]!);
      if (content.kind === 'marble' && content.id !== marbleId) return i;
    }
    return -1;
  }

  private findBlockedCells(change: Extract<TapChange, { kind: 'blocked' }>): Cell[] {
    const targets: Cell[] = [];
    for (const gate of this.engine.level.gates) {
      if (gate.color !== change.color) continue;
      const mouth = gateMouthCell(gate, this.engine.cols, this.engine.rows);
      const content = this.engine.contentAt(mouth);
      if (content.kind !== 'void' && content.kind !== 'plug') targets.push(mouth);
    }
    if (targets.length === 0) return [change.cell];
    const targetKeys = new Set(targets.map(cellKey));
    const dirs: readonly Cell[] = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];

    const intendedCells = this.findIntendedBlockedCells(change, targetKeys, dirs);
    if (intendedCells) return intendedCells;

    const queue: BlockedPathNode[] = [{ cell: change.cell, dir: -1, cost: 0, prev: null }];
    const seen = new Map<string, number>();
    let bestCollision: { cells: Cell[]; gateDistance: number; cost: number } | null = null;

    while (queue.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < queue.length; i += 1) {
        if (queue[i]!.cost < queue[bestIdx]!.cost) bestIdx = i;
      }
      const node = queue.splice(bestIdx, 1)[0]!;
      const nodeKey = `${node.cell.x},${node.cell.y},${node.dir}`;
      const prevBest = seen.get(nodeKey);
      if (prevBest !== undefined && prevBest <= node.cost) continue;
      seen.set(nodeKey, node.cost);

      if (targetKeys.has(cellKey(node.cell))) return reconstructCells(node);

      for (let d = 0; d < dirs.length; d += 1) {
        const dir = dirs[d]!;
        const next: Cell = { x: node.cell.x + dir.x, y: node.cell.y + dir.y };
        const content = this.engine.contentAt(next);
        if (content.kind === 'marble' && content.id !== change.marbleId) {
          const gateDistance = minGateDistance(next, targets);
          const cost = node.cost + 100;
          if (
            !bestCollision ||
            gateDistance < bestCollision.gateDistance ||
            (gateDistance === bestCollision.gateDistance && cost < bestCollision.cost)
          ) {
            bestCollision = {
              cells: [...reconstructCells(node), next],
              gateDistance,
              cost,
            };
          }
          continue;
        }
        if (content.kind !== 'empty') continue;
        const turn = node.dir !== -1 && node.dir !== d ? 1 : 0;
        queue.push({ cell: next, dir: d, cost: node.cost + 100 + turn, prev: node });
      }
    }

    return bestCollision?.cells ?? [change.cell];
  }

  private findIntendedBlockedCells(
    change: Extract<TapChange, { kind: 'blocked' }>,
    targetKeys: Set<string>,
    dirs: readonly Cell[],
  ): Cell[] | null {
    const queue: PathNodeWithBlockers[] = [{
      cell: change.cell,
      dir: -1,
      cost: 0,
      blockers: 0,
      prev: null,
    }];
    const seen = new Map<string, number>();

    while (queue.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < queue.length; i += 1) {
        if (queue[i]!.cost < queue[bestIdx]!.cost) bestIdx = i;
      }
      const node = queue.splice(bestIdx, 1)[0]!;
      const nodeKey = `${node.cell.x},${node.cell.y},${node.dir}`;
      const prevBest = seen.get(nodeKey);
      if (prevBest !== undefined && prevBest <= node.cost) continue;
      seen.set(nodeKey, node.cost);

      if (targetKeys.has(cellKey(node.cell)) && node.blockers > 0) return reconstructBlockedCells(node);

      for (let d = 0; d < dirs.length; d += 1) {
        const dir = dirs[d]!;
        const next: Cell = { x: node.cell.x + dir.x, y: node.cell.y + dir.y };
        const content = this.engine.contentAt(next);
        if (content.kind === 'void' || content.kind === 'plug') continue;
        const isOtherMarble = content.kind === 'marble' && content.id !== change.marbleId;
        const turn = node.dir !== -1 && node.dir !== d ? 1 : 0;
        // Prefer routes with fewer occupied cells, then shorter/straighter paths.
        const blockerCost = isOtherMarble ? 10_000 : 0;
        queue.push({
          cell: next,
          dir: d,
          cost: node.cost + blockerCost + 100 + turn,
          blockers: node.blockers + (isOtherMarble ? 1 : 0),
          prev: node,
        });
      }
    }

    return null;
  }

  private firstAvailableNudge(cell: Cell, y: number): THREE.Vector3 | null {
    const start = this.cellToWorld(cell, y);
    const dirs: readonly Cell[] = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];
    for (const dir of dirs) {
      const next: Cell = { x: cell.x + dir.x, y: cell.y + dir.y };
      const content = this.engine.contentAt(next);
      if (content.kind === 'void' || content.kind === 'plug') continue;
      return start.clone().lerp(this.cellToWorld(next, y), 0.42);
    }
    return null;
  }

  private triggerMistakeFeedback(pos: THREE.Vector3, color: MarbleColor, blockerId: number | null): void {
    this.mistakeFeedbackT = MISTAKE_FEEDBACK_S;
    document.body.classList.remove('mistake-feedback');
    void document.body.offsetWidth;
    document.body.classList.add('mistake-feedback');
    if (this.mistakeFeedbackTimer !== null) window.clearTimeout(this.mistakeFeedbackTimer);
    const timer = window.setTimeout(() => {
      if (this.mistakeFeedbackTimer !== timer) return;
      this.mistakeFeedbackTimer = null;
      document.body.classList.remove('mistake-feedback');
    }, MISTAKE_FEEDBACK_MS);
    this.mistakeFeedbackTimer = timer;
    this.burstAt(pos, color);
    this.spawnImpactRing(pos);
    if (blockerId === null) return;
    const blocker = this.marbles.get(blockerId);
    if (blocker) {
      this.hints.push({ mesh: blocker.mesh, t: 0 });
      this.wobbles.push({ mesh: blocker.mesh, t: 0.0001 });
    }
  }

  private spawnImpactRing(pos: THREE.Vector3): void {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(W3D.MARBLE_R * 1.05, 0.035, 8, 34),
      new THREE.MeshBasicMaterial({
        color: 0xff5f70,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.position.set(pos.x, pos.y - W3D.MARBLE_R * 0.7, pos.z);
    ring.rotation.x = Math.PI / 2;
    ring.scale.setScalar(0.62);
    this.root.add(ring);
    this.impactRings.push({ mesh: ring, t: 0, life: 0.42 });
  }

  /** Color burst at a world position (gate absorb). */
  burstAt(pos: THREE.Vector3, color: MarbleColor): void {
    const n = 14;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(n * 3);
    const vel: THREE.Vector3[] = [];
    for (let i = 0; i < n; i += 1) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y + 0.1;
      positions[i * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2;
      vel.push(
        new THREE.Vector3(
          Math.cos(a) * (0.8 + Math.random()),
          1.6 + Math.random() * 1.4,
          Math.sin(a) * (0.8 + Math.random()),
        ),
      );
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: COLORS3D.marble[color],
      size: 0.13,
      transparent: true,
      opacity: 0.95,
    });
    const pts = new THREE.Points(geo, mat);
    this.root.add(pts);
    this.sparks.push({ pts, vel, t: 0 });
  }

  private spawnCollectionBurst(gate: GateDef, color: MarbleColor, streak = 1): void {
    const gatePos = this.gateWorld(gate);
    const mouth = gateMouthCell(gate, this.engine.cols, this.engine.rows);
    const mouthPos = this.cellToWorld(mouth, 0.26);
    const pos = gatePos.clone().lerp(mouthPos, 0.22);
    pos.y = 0.34;
    const juice = comboJuice(streak);

    this.spawnCollectionRing(pos, color, juice);
    this.spawnCollectionParticles(pos, color, juice);
  }

  private spawnCollectionRing(pos: THREE.Vector3, color: MarbleColor, juice: number): void {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(W3D.MARBLE_R * (0.86 + juice * 0.06), 0.038 + juice * 0.012, 8, 44),
      new THREE.MeshBasicMaterial({
        color: COLORS3D.marble[color],
        transparent: true,
        opacity: 0.84 + Math.min(0.15, juice * 0.04),
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.position.copy(pos);
    ring.rotation.x = Math.PI / 2;
    ring.scale.setScalar(0.5);
    this.root.add(ring);
    this.collectRings.push({
      mesh: ring,
      t: 0,
      life: 0.42 + juice * 0.08,
      maxScale: 1.65 + juice * 0.42,
      opacity: 0.84 + Math.min(0.15, juice * 0.04),
    });
  }

  private spawnCollectionParticles(pos: THREE.Vector3, color: MarbleColor, juice: number): void {
    const n = Math.round(26 + juice * 12);
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const vel: THREE.Vector3[] = [];
    const marbleColor = new THREE.Color(COLORS3D.marble[color]);
    const gold = new THREE.Color(0xffe066);
    const white = new THREE.Color(0xffffff);

    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.08 + Math.random() * (0.22 + juice * 0.05);
      positions[i * 3] = pos.x + Math.cos(a) * r;
      positions[i * 3 + 1] = pos.y + Math.random() * 0.08;
      positions[i * 3 + 2] = pos.z + Math.sin(a) * r;

      const speed = (0.9 + Math.random() * 1.2) * (0.9 + juice * 0.18);
      vel.push(
        new THREE.Vector3(
          Math.cos(a) * speed,
          0.68 + Math.random() * (1.18 + juice * 0.24),
          Math.sin(a) * speed,
        ),
      );

      const c = i % 5 === 0 ? white : i % 3 === 0 ? gold : marbleColor;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.14 + juice * 0.02,
        transparent: true,
        opacity: 0.98,
        vertexColors: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.root.add(pts);
    this.collectBursts.push({ pts, vel, t: 0, life: 0.66 + juice * 0.12 });
  }

  breakCompletedColor(color: MarbleColor): void {
    for (const gate of this.engine.level.gates) {
      if (gate.color !== color) continue;
      const key = gateKey(gate);
      const group = this.gates.get(key);
      if (!group) continue;
      this.gates.delete(key);
      group.userData.breaking = true;
      this.breakingGates.push({ gate: group, t: 0 });
      this.burstAt(group.position.clone(), color);
      this.spawnGateShards(group.position.clone(), color);
    }
  }

  private spawnGateShards(pos: THREE.Vector3, color: MarbleColor): void {
    const shardGeo = new THREE.BoxGeometry(0.16, 0.1, 0.16);
    for (let i = 0; i < 10; i += 1) {
      const mat = new THREE.MeshStandardMaterial({
        color: i % 3 === 0 ? 0xffffff : COLORS3D.marble[color],
        roughness: 0.28,
        metalness: 0.02,
      });
      const mesh = new THREE.Mesh(shardGeo.clone(), mat);
      mesh.position.set(
        pos.x + (Math.random() - 0.5) * 0.26,
        pos.y + 0.22 + Math.random() * 0.12,
        pos.z + (Math.random() - 0.5) * 0.26,
      );
      mesh.scale.setScalar(0.7 + Math.random() * 0.7);
      mesh.castShadow = true;
      this.root.add(mesh);
      const a = Math.random() * Math.PI * 2;
      this.gateShards.push({
        mesh,
        vel: new THREE.Vector3(
          Math.cos(a) * (0.75 + Math.random() * 0.8),
          1.25 + Math.random() * 1.15,
          Math.sin(a) * (0.75 + Math.random() * 0.8),
        ),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 9,
          (Math.random() - 0.5) * 8,
        ),
        t: 0,
        life: 0.72 + Math.random() * 0.16,
      });
    }
  }

  /**
   * Roll trail (locked in 2026-07-16, "Ghost"): translucent afterimages of the
   * marble itself, fading in place — inherently ball-colored and orientation-
   * free, so corners never show stale streaks.
   */
  private emitTrail(pos: THREE.Vector3, color: MarbleColor): void {
    // Half cadence keeps the ghosts readable as discrete copies.
    this.ghostToggle = !this.ghostToggle;
    if (this.ghostToggle) return;
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLORS3D.marble[color]).lerp(new THREE.Color(0xffffff), 0.1),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const ghost = new THREE.Mesh(ghostGeometry(), mat);
    ghost.scale.setScalar(W3D.MARBLE_R * 0.92);
    ghost.userData.unitScale = W3D.MARBLE_R * 0.92;
    ghost.userData.sharedGeometry = true;
    ghost.position.copy(pos);
    ghost.userData.baseScale = { x: 1, y: 1 };
    ghost.userData.baseOpacity = 0.42;
    ghost.userData.shrink = true;
    this.root.add(ghost);
    this.trailRibbons.push({ mesh: ghost, t: 0, life: 0.65 });
  }

  // ── Frame tick ───────────────────────────────────────────────────

  tick(dt: number): void {
    const shouldRollSound = this.rolls.length > 0 || this.blockedRolls.length > 0;
    if (shouldRollSound !== this.rollingSoundActive) {
      this.rollingSoundActive = shouldRollSound;
      setRollingActive(shouldRollSound);
    }

    // Board entry settle.
    if (this.entryT < 1) {
      this.entryT = Math.min(this.entryT + dt / 0.4, 1);
      const e = 1 - Math.pow(1 - this.entryT, 3); // cubic out
      this.root.position.y = -0.55 * (1 - e);
      const sc = 0.94 + 0.06 * e;
      this.root.scale.setScalar(sc);
    }
    if (this.mistakeFeedbackT > 0) {
      this.mistakeFeedbackT = Math.max(0, this.mistakeFeedbackT - dt);
      const k = this.mistakeFeedbackT / MISTAKE_FEEDBACK_S;
      const shake = Math.sin(k * Math.PI * 18) * k;
      this.root.position.x = shake * 0.045;
      this.root.position.z = Math.cos(k * Math.PI * 16) * k * 0.035;
      this.root.rotation.z = shake * 0.018;
    } else {
      this.root.position.x = 0;
      this.root.position.z = 0;
      this.root.rotation.z = 0;
    }

    // Route preview: traveling pulse so the hint reads as a path, not a static overlay.
    if (this.routePreview) {
      this.routePreviewT += dt;
      for (const child of this.routePreview.children) {
        const data = child.userData as { routeKind?: string; baseScale?: number; phase?: number };
        if (data.routeKind === 'line') {
          const line = child as THREE.Line;
          const mat = line.material as THREE.LineBasicMaterial;
          mat.opacity = 0.68 + 0.22 * (0.5 + 0.5 * Math.sin(this.routePreviewT * 5.2));
          continue;
        }
        if (data.routeKind === 'beam') {
          const beam = child as THREE.Mesh;
          const phase = data.phase ?? 0;
          const wave = 0.5 + 0.5 * Math.sin(this.routePreviewT * 7 - phase);
          const mat = beam.material as THREE.MeshBasicMaterial;
          mat.opacity = 0.54 + wave * 0.34;
          continue;
        }
        if (data.routeKind !== 'marker' && data.routeKind !== 'dot') continue;
        const mesh = child as THREE.Mesh;
        const phase = data.phase ?? 0;
        const wave = 0.5 + 0.5 * Math.sin(this.routePreviewT * 7 - phase);
        const base = data.baseScale ?? 1;
        mesh.scale.setScalar(base * (0.86 + wave * 0.34));
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = data.routeKind === 'marker' ? 0.54 + wave * 0.36 : 0.34 + wave * 0.42;
      }
    }

    // Spawns: rain-in with bounce.
    for (const s of this.spawns) {
      s.t += dt;
      const local = s.t - s.delay;
      if (local < 0) continue;
      if (!s.ticked) {
        s.ticked = true;
        s.node.mesh.visible = true;
        spawnTick(s.index);
      }
      const k = Math.min(local / 0.42, 1);
      const b = bounceOut(k);
      s.node.group.position.y = s.targetY + W3D.DROP_HEIGHT * (1 - b);
      const sh = s.node.shadow;
      sh.scale.setScalar(0.2 + 0.8 * k);
      (sh.material as THREE.MeshBasicMaterial).opacity = 0.3 * k;
    }
    this.spawns = this.spawns.filter((s) => s.t - s.delay < 0.45);

    // Rolls: constant speed along the path + real rolling rotation.
    const speed = W3D.ROLL_SPEED * W3D.CELL * this.animationSpeedMultiplier;
    const done: RollAnim[] = [];
    for (const r of this.rolls) {
      r.t += (dt * speed) / r.totalLen;
      const t = Math.min(r.t, 1);
      const dist = t * r.totalLen;

      let acc = 0;
      let seg = 0;
      while (seg < r.segLens.length - 1 && acc + r.segLens[seg] < dist) {
        acc += r.segLens[seg];
        seg += 1;
      }
      const segT = r.segLens[seg] === 0 ? 0 : (dist - acc) / r.segLens[seg];
      const a = r.points[seg];
      const b = r.points[seg + 1];
      const pos = a.clone().lerp(b, segT);

      if (t > 0.88) {
        const k = (t - 0.88) / 0.12;
        pos.y -= k * 0.5;
        r.node.mesh.scale.setScalar(1 - 0.4 * k);
      }
      r.node.group.position.copy(pos);
      r.node.shadow.position.x = pos.x;
      r.node.shadow.position.z = pos.z;
      (r.node.shadow.material as THREE.MeshBasicMaterial).opacity =
        0.3 * (1 - Math.max(0, (t - 0.88) / 0.12));

      const dir = b.clone().sub(a).normalize();
      const axis = new THREE.Vector3(dir.z, 0, -dir.x);
      r.node.mesh.rotateOnWorldAxis(axis, (dt * speed) / W3D.MARBLE_R);

      r.trailT += dt;
      while (r.trailT >= W3D.TRAIL_EMIT_S) {
        r.trailT -= W3D.TRAIL_EMIT_S;
        this.emitTrail(pos, r.change.color);
      }

      const cellsCrossed = Math.floor(dist / W3D.CELL);
      if (cellsCrossed > r.lastTic) {
        r.lastTic = cellsCrossed;
        rollTic();
      }

      if (t >= 1) done.push(r);
    }
    for (const r of done) {
      this.rolls.splice(this.rolls.indexOf(r), 1);
      this.root.remove(r.node.group);
      this.root.remove(r.node.shadow);
      const gate = this.gates.get(gateKey(r.change.gate));
      if (gate) {
        (gate.userData as { gulp?: number }).gulp = 1;
        // Hole flash: brief emissive blink on the housing.
        const flashed = this.gatePrimaryMeshes(gate);
        for (const mesh of flashed) {
          const mat = mesh.material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(0xffffff);
          mat.emissiveIntensity = 0.5;
        }
        window.setTimeout(() => {
          for (const mesh of flashed) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            mat.emissiveIntensity = 0;
            mat.emissive.setHex(0x000000);
          }
        }, 130);
      }
      this.spawnCollectionBurst(r.change.gate, r.change.color, r.change.streak);
      this.callbacks.onAbsorbed(r.change);
    }
    if (done.length > 0 && this.rolls.length === 0 && this.rollingSoundActive) {
      this.rollingSoundActive = false;
      setRollingActive(false);
    }

    const blockedDone: BlockedRollAnim[] = [];
    const blockedSpeed = W3D.ROLL_SPEED * W3D.CELL * 1.08 * this.animationSpeedMultiplier;
    for (const r of this.blockedRolls) {
      const delta = (dt * blockedSpeed) / r.totalLen;
      r.t = r.returning ? Math.max(0, r.t - delta * 1.28) : Math.min(1, r.t + delta);
      const dist = r.t * r.totalLen;

      let acc = 0;
      let seg = 0;
      while (seg < r.segLens.length - 1 && acc + r.segLens[seg]! < dist) {
        acc += r.segLens[seg]!;
        seg += 1;
      }
      const segLen = r.segLens[seg] ?? 0;
      const segT = segLen === 0 ? 0 : (dist - acc) / segLen;
      const a = r.points[seg]!;
      const b = r.points[seg + 1]!;
      const pos = a.clone().lerp(b, segT);
      r.node.group.position.copy(pos);
      r.node.shadow.position.x = pos.x;
      r.node.shadow.position.z = pos.z;

      const dir = b.clone().sub(a).normalize();
      const axis = new THREE.Vector3(dir.z, 0, -dir.x);
      const direction = r.returning ? -1 : 1;
      r.node.mesh.rotateOnWorldAxis(axis, direction * (dt * blockedSpeed) / W3D.MARBLE_R);

      r.trailT += dt;
      if (!r.returning && r.trailT >= W3D.TRAIL_EMIT_S * 1.2) {
        r.trailT = 0;
        this.emitTrail(pos, r.color);
      }

      if (!r.returning && r.t >= 1) {
        r.returning = true;
        this.triggerMistakeFeedback(pos, r.color, r.blockerId);
        this.callbacks.onBlockedImpact(r.change);
        rollTic();
      }

      if (r.returning && r.t <= 0.001) {
        r.node.group.position.copy(r.points[0]!);
        r.node.shadow.position.x = r.points[0]!.x;
        r.node.shadow.position.z = r.points[0]!.z;
        r.node.mesh.scale.set(1, 1, 1);
        blockedDone.push(r);
      }
    }
    for (const r of blockedDone) {
      this.blockedRolls.splice(this.blockedRolls.indexOf(r), 1);
    }

    // Gates break away after their color is complete.
    for (const b of this.breakingGates) {
      b.t += dt;
      const k = Math.min(b.t / 0.58, 1);
      const ease = 1 - Math.pow(1 - k, 3);
      b.gate.position.y = 0.28 * ease;
      b.gate.rotation.y += dt * 5.5;
      b.gate.rotation.z += dt * 2.2;
      b.gate.scale.setScalar(1 - ease);
      b.gate.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.Material | THREE.Material[];
        const apply = (m: THREE.Material): void => {
          m.transparent = true;
          m.opacity = Math.max(0, 1 - ease);
        };
        if (Array.isArray(mat)) mat.forEach(apply);
        else if (mat) apply(mat);
      });
      if (k >= 1) {
        this.root.remove(b.gate);
        disposeObject(b.gate);
      }
    }
    this.breakingGates = this.breakingGates.filter((b) => b.t < 0.58);

    for (const shard of this.gateShards) {
      shard.t += dt;
      shard.vel.y -= dt * 4.6;
      shard.mesh.position.addScaledVector(shard.vel, dt);
      shard.mesh.rotation.x += shard.spin.x * dt;
      shard.mesh.rotation.y += shard.spin.y * dt;
      shard.mesh.rotation.z += shard.spin.z * dt;
      const k = Math.min(shard.t / shard.life, 1);
      shard.mesh.scale.setScalar(Math.max(0.01, 1 - k * 0.82));
      const mat = shard.mesh.material as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this.root.remove(shard.mesh);
        shard.mesh.geometry.dispose();
        mat.dispose();
      }
    }
    this.gateShards = this.gateShards.filter((shard) => shard.t <= shard.life);

    // Jelly wobbles (v3 feel).
    for (const w of this.wobbles) {
      w.t += dt;
      const k = w.t / 0.38;
      if (k >= 1) {
        w.mesh.scale.set(1, 1, 1);
        continue;
      }
      const osc = Math.sin(k * Math.PI * 3) * (1 - k) * 0.14;
      w.mesh.scale.set(1 + osc, 1 - osc, 1 + osc);
    }
    this.wobbles = this.wobbles.filter((w) => w.t < 0.38);

    // Gate gulps.
    for (const g of this.gates.values()) {
      const gu = g.userData as { gulp?: number };
      if (gu.gulp && gu.gulp > 0) {
        gu.gulp = Math.max(0, gu.gulp - dt * 4);
        const k = Math.sin((1 - gu.gulp) * Math.PI);
        g.scale.set(1 + 0.18 * k, 1 - 0.16 * k, 1 + 0.18 * k);
      }
    }

    // Hint pulses: emissive breathe for ~1.4s.
    for (const hint of this.hints) {
      hint.t += dt;
      const mat = hint.mesh.material as THREE.MeshStandardMaterial;
      const k = hint.t / 1.4;
      if (k >= 1) {
        mat.emissive.setRGB(0, 0, 0);
        mat.emissiveIntensity = 0;
        continue;
      }
      const wave = Math.max(0, Math.sin(k * Math.PI * 3));
      mat.emissive.setRGB(1, 1, 1);
      mat.emissiveIntensity = wave * 0.36;
    }
    this.hints = this.hints.filter((h) => h.t < 1.4);

    // Sparks.
    for (const s of this.sparks) {
      s.t += dt;
      const positions = s.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < s.vel.length; i += 1) {
        s.vel[i].y -= dt * 6;
        positions.setXYZ(
          i,
          positions.getX(i) + s.vel[i].x * dt,
          positions.getY(i) + s.vel[i].y * dt,
          positions.getZ(i) + s.vel[i].z * dt,
        );
      }
      positions.needsUpdate = true;
      (s.pts.material as THREE.PointsMaterial).opacity = Math.max(0, 0.95 - s.t * 1.6);
      if (s.t > 0.7) {
        this.root.remove(s.pts);
        s.pts.geometry.dispose();
      }
    }
    this.sparks = this.sparks.filter((s) => s.t <= 0.7);

    for (const burst of this.collectBursts) {
      burst.t += dt;
      const positions = burst.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < burst.vel.length; i += 1) {
        burst.vel[i].y -= dt * 2.9;
        positions.setXYZ(
          i,
          positions.getX(i) + burst.vel[i].x * dt,
          positions.getY(i) + burst.vel[i].y * dt,
          positions.getZ(i) + burst.vel[i].z * dt,
        );
      }
      positions.needsUpdate = true;
      const k = Math.min(burst.t / burst.life, 1);
      (burst.pts.material as THREE.PointsMaterial).opacity = Math.max(0, 0.98 * (1 - k));
      if (k >= 1) {
        this.root.remove(burst.pts);
        burst.pts.geometry.dispose();
        (burst.pts.material as THREE.PointsMaterial).dispose();
      }
    }
    this.collectBursts = this.collectBursts.filter((burst) => burst.t <= burst.life);

    for (const ring of this.collectRings) {
      ring.t += dt;
      const k = Math.min(ring.t / ring.life, 1);
      const ease = 1 - Math.pow(1 - k, 3);
      ring.mesh.scale.setScalar(0.5 + ease * ring.maxScale);
      ring.mesh.position.y += dt * 0.04;
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, ring.opacity * (1 - k));
      if (k >= 1) {
        this.root.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        (ring.mesh.material as THREE.MeshBasicMaterial).dispose();
      }
    }
    this.collectRings = this.collectRings.filter((ring) => ring.t <= ring.life);


    for (const ribbon of this.trailRibbons) {
      ribbon.t += dt;
      const k = Math.min(ribbon.t / ribbon.life, 1);
      const base = (ribbon.mesh.userData.baseScale as { x: number; y: number }) ?? { x: 1, y: 1 };
      const baseOpacity = (ribbon.mesh.userData.baseOpacity as number) ?? 0.44;
      if (ribbon.mesh.userData.shrink) {
        const unit = (ribbon.mesh.userData.unitScale as number) ?? 1;
        ribbon.mesh.scale.setScalar(unit * Math.max(0.05, 1 - k * 0.85));
      } else if (ribbon.mesh.userData.grow) {
        ribbon.mesh.scale.setScalar(1 + k * 2.1);
      } else {
        ribbon.mesh.scale.x = base.x + k * base.x * 0.48;
        ribbon.mesh.scale.y = base.y + k * base.y * 0.57;
      }
      ribbon.mesh.position.y -= dt * 0.035;
      (ribbon.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, baseOpacity * (1 - k));
      if (k >= 1) {
        this.root.remove(ribbon.mesh);
        if (!ribbon.mesh.userData.sharedGeometry) ribbon.mesh.geometry.dispose();
        (ribbon.mesh.material as THREE.MeshBasicMaterial).dispose();
      }
    }
    this.trailRibbons = this.trailRibbons.filter((ribbon) => ribbon.t <= ribbon.life);

    for (const ring of this.impactRings) {
      ring.t += dt;
      const k = Math.min(ring.t / ring.life, 1);
      const ease = 1 - Math.pow(1 - k, 3);
      ring.mesh.scale.setScalar(0.62 + ease * 1.55);
      ring.mesh.position.y += dt * 0.025;
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.82 * (1 - k));
      if (k >= 1) {
        this.root.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        (ring.mesh.material as THREE.MeshBasicMaterial).dispose();
      }
    }
    this.impactRings = this.impactRings.filter((ring) => ring.t <= ring.life);

  }

  dispose(): void {
    setRollingActive(false);
    if (this.mistakeFeedbackTimer !== null) {
      window.clearTimeout(this.mistakeFeedbackTimer);
      this.mistakeFeedbackTimer = null;
    }
    document.body.classList.remove('mistake-feedback');
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const m = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      }
    });
  }
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh | THREE.Line | THREE.Points;
    if ('geometry' in mesh) mesh.geometry?.dispose();
    if ('material' in mesh) {
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    }
  });
}

function plugMaterial(part: ModelerSpecPart, color: THREE.Color): THREE.Material {
  if (part.id === 'plug-shadow-ring') {
    return new THREE.MeshStandardMaterial({
      color: 0x14233b,
      roughness: 0.68,
      metalness: 0,
    });
  }
  if (part.id === 'porcelain-cap') {
    return new THREE.MeshPhysicalMaterial({
      color: 0x263a5a,
      roughness: 0.34,
      clearcoat: 0.42,
      clearcoatRoughness: 0.24,
    });
  }
  if (part.id === 'cap-gloss') {
    return new THREE.MeshBasicMaterial({
      color: 0x7ee9ff,
      transparent: true,
      // Simplified style: the circular highlight dots are dropped everywhere.
      opacity: 0,
      depthWrite: false,
    });
  }
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.64,
    metalness: 0,
  });
}

function gateMaterial(part: ModelerSpecPart, color: THREE.Color, primaryColor: number): THREE.Material {
  if (part.id === 'primary-cup') {
    const cup = new THREE.Color(primaryColor);
    return new THREE.MeshStandardMaterial({
      color: cup,
      roughness: 0.16,
      metalness: 0.02,
      emissive: cup.clone().multiplyScalar(0.08),
    });
  }
  if (part.id === 'mouth-shadow') {
    return new THREE.MeshStandardMaterial({
      color: 0x5e2a40,
      roughness: 0.95,
      metalness: 0,
    });
  }
  if (part.id?.includes('bolt')) {
    // Simplified style: the white candy-bolt dots on the targets stay hidden.
    return new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  }
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.46,
    metalness: 0,
  });
}

function marbleMaterial(part: ModelerSpecPart, color: THREE.Color, primaryColor: number): THREE.Material {
  if (part.id === 'core') {
    return new THREE.MeshPhysicalMaterial({
      clearcoat: 0.45,
      clearcoatRoughness: 0.35,
      color: 0xffffff,
      map: marbleTexture(primaryColor),
      roughness: 0.42,
      metalness: 0,
    });
  }
  // gloss-spot: hidden — the simplified look has no painted highlight dot.
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
}

let woodTex: THREE.CanvasTexture | null = null;
function woodTexture(): THREE.CanvasTexture {
  if (woodTex) return woodTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  const base = g.createLinearGradient(0, 0, 256, 256);
  base.addColorStop(0, '#f5bd88');
  base.addColorStop(0.5, '#c97b4c');
  base.addColorStop(1, '#9b5434');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let x = -40; x < 296; x += 18) {
    g.strokeStyle = x % 36 === 0 ? 'rgba(92,43,24,0.24)' : 'rgba(255,236,205,0.2)';
    g.lineWidth = x % 36 === 0 ? 4 : 2;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + 16, 72, x - 14, 164, x + 22, 256);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(0, 0, 256, 42);
  woodTex = new THREE.CanvasTexture(c);
  woodTex.colorSpace = THREE.SRGBColorSpace;
  woodTex.wrapS = THREE.RepeatWrapping;
  woodTex.wrapT = THREE.RepeatWrapping;
  woodTex.anisotropy = 4;
  return woodTex;
}

let softPanelTex: THREE.CanvasTexture | null = null;
function softPanelTexture(): THREE.CanvasTexture {
  if (softPanelTex) return softPanelTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  const bg = g.createRadialGradient(128, 72, 10, 128, 128, 180);
  bg.addColorStop(0, BOARD_PANEL_STOPS[0]);
  bg.addColorStop(0.62, BOARD_PANEL_STOPS[1]);
  bg.addColorStop(1, BOARD_PANEL_STOPS[2]);
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(141,78,91,0.08)';
  g.lineWidth = 2;
  for (let y = 12; y < 256; y += 18) {
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(62, y + 5, 142, y - 6, 256, y + 2);
    g.stroke();
  }
  softPanelTex = new THREE.CanvasTexture(c);
  softPanelTex.colorSpace = THREE.SRGBColorSpace;
  softPanelTex.anisotropy = 4;
  return softPanelTex;
}

/**
 * Locked-in visual style (chosen via the marble-run-simplification portal
 * chain, 2026-07-16): "Vivid Marbled" balls — low-contrast swirl marbling on
 * saturated candy colors, no painted shine — on the "Dots" board — pale
 * neutral tray with small flat position dots instead of pink dimple cups.
 */
const BOARD_SURFACE = 0xf3efe9;
const BOARD_PANEL_STOPS = ['#faf8f4', '#f2eee8', '#e4dcd4'] as const;
const CELL_DOT_COLOR = 0xccc4b7;



const marbleTex = new Map<number, THREE.CanvasTexture>();
function marbleTexture(color: number): THREE.CanvasTexture {
  const existing = marbleTex.get(color);
  if (existing) return existing;
  const base = new THREE.Color(color);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  // Mostly-solid base with a gentle top-to-bottom shade so the sphere reads
  // as round without competing surface detail.
  const softLight = base.clone().lerp(new THREE.Color(0xffffff), 0.22);
  const softDark = base.clone().multiplyScalar(0.8);
  const bg = g.createLinearGradient(0, 0, 0, 128);
  bg.addColorStop(0, `#${softLight.getHexString()}`);
  bg.addColorStop(0.55, `#${base.getHexString()}`);
  bg.addColorStop(1, `#${softDark.getHexString()}`);
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 128);
  // The classic swirls at a fraction of the original contrast: enough texture
  // to read as marbling without competing with the ball's base color.
  for (let i = 0; i < 5; i += 1) {
    g.strokeStyle = i % 2 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(80,35,70,0.07)';
    g.lineWidth = i % 2 === 0 ? 13 : 8;
    g.beginPath();
    const y = 18 + i * 21;
    g.moveTo(-20, y);
    g.bezierCurveTo(48, y - 34, 96, y + 42, 158, y + 2);
    g.bezierCurveTo(196, y - 22, 224, y + 18, 276, y - 10);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  marbleTex.set(color, tex);
  return tex;
}

let ghostGeo: THREE.SphereGeometry | null = null;
/** Shared unit sphere for ghost afterimages (scaled per instance). */
function ghostGeometry(): THREE.SphereGeometry {
  if (!ghostGeo) ghostGeo = new THREE.SphereGeometry(1, 18, 14);
  return ghostGeo;
}

let cellDotGeo: THREE.CircleGeometry | null = null;
let cellDotMat: THREE.MeshStandardMaterial | null = null;
/** All empty-cell dots share one geometry + material (static, identical). */
function cellDotGeometry(): THREE.CircleGeometry {
  if (!cellDotGeo) cellDotGeo = new THREE.CircleGeometry(0.15, 24);
  return cellDotGeo;
}
function cellDotMaterial(): THREE.MeshStandardMaterial {
  if (!cellDotMat) cellDotMat = new THREE.MeshStandardMaterial({ color: CELL_DOT_COLOR, roughness: 0.8 });
  return cellDotMat;
}

function gateKey(gate: GateDef): string {
  return `${gate.side}:${gate.index}:${gate.color}`;
}

function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

function minGateDistance(cell: Cell, targets: Cell[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const d = Math.abs(cell.x - target.x) + Math.abs(cell.y - target.y);
    if (d < best) best = d;
  }
  return best;
}

function reconstructCells(node: BlockedPathNode): Cell[] {
  const out: Cell[] = [];
  let cur: BlockedPathNode | null = node;
  while (cur) {
    out.push(cur.cell);
    cur = cur.prev;
  }
  out.reverse();
  return out;
}

function reconstructBlockedCells(node: PathNodeWithBlockers): Cell[] {
  const out: Cell[] = [];
  let cur: PathNodeWithBlockers | null = node;
  while (cur) {
    out.push(cur.cell);
    cur = cur.prev;
  }
  out.reverse();
  return out;
}

function comboJuice(streak: number): number {
  return Math.min(2.25, 1 + Math.max(0, streak - 1) * 0.18);
}

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}
