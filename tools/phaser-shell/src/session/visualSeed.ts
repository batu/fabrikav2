// Deterministic REAL PHASER EDITOR visual-seed operation (U5, card gJtZP63y).
//
// The seven shell scenes carry the 48 correct semantic carriers but no visual
// companions, so each screen renders as bare labels on a black canvas. This
// module composes a light mobile shell for every screen — comparable to the
// accepted Grapes P0 — using ONLY Editor-native, NON-semantic companion objects
// (backgrounds/cards, real raster button surfaces, docks, modal scrims, green
// toggle switches, a shop grid, and result copy). It never hand-edits a
// canonical `.scene` or generated `.ts`: it drives the installed Phaser Editor
// 5.0.2 workbench against a RESET SCRATCH outside the repository, creating
// objects through `SceneSnapshotOperation` + `SceneMaker.createObject` (after
// `PackFinder.preload` + `updateSceneLoaderWithGameObjectDataList`) and updating
// semantic result copy through `SimpleOperation`, then saves via the Editor and
// delegates compile-twice + terminate/restart/reopen byte-stability to the proven
// `captureProvenance` seam.
//
// It is a TOOL: `runVisualSeed` / `runVisualSeedSession` perform the fixed
// operation once and RETURN a typed result — never a loop, never self-directed,
// never faked. The companion recipe is deterministic data with stable Editor
// ids/names so the focused tests can inspect it without an Editor, and the two
// invariants that matter are enforced by construction: a companion NEVER carries
// a `Semantic` component, and the 48 semantic ids (plus the hidden win next/home
// behaviour) are preserved.
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { resetToScratch, type ScratchResult } from '../reset.ts';
import { captureProvenance } from './provenance.ts';
import { SCENE_AUTHORITY, SCENE_FILES, hashGraph } from './graph.ts';
import {
  getServerMode,
  resolveServerBin,
  startEditorServer,
  stopEditorServer,
  ServerBlocked,
} from './editorServer.ts';
import { closeConnectedCdpBrowser, closeWorkbench, openWorkbench, WorkbenchBlocked, type Workbench } from './workbench.ts';
import { assertNoLeaks, scrubText, type ProvenanceEvidence, type ServerMode } from './evidence.ts';
import { PathBlocked, REPO_ROOT, resolveScratch } from './paths.ts';

export const VISUAL_SEED_SCHEMA = 'u5.phaser.visual-seed/1';

/**
 * Exact composed result copy (card spec). The middle dot is U+00B7.
 */
export const RESULT_COPY = {
  'win.reward': '5 Coins earned',
  'win.claim-double': 'Watch ad · Double Coins',
  'fail.continue-coins': 'Continue · 10 Coins',
  'fail.bundle': 'Rescue bundle · $4.99\nContinue this level',
} as const;

/** Two-card structural placeholder shop copy; no checkout or real-price claim is implied. */
export const SHOP_COPY = {
  'shop.item.available': 'Coin Pack',
  'shop.item.owned': 'No Ads',
  // The schema-required third carrier is deliberately inert in the V1 shop.
  'shop.item.locked': ' ',
  'shop.restore': 'Restore purchases',
} as const;

/** Sample-game presentation copy keeps the reusable shell credible in player view. */
export const SAMPLE_COPY = {
  'menu.title': 'Trailbound',
  'level.label': 'Trail 2',
  'level.test-win': 'Win',
  'level.test-lose': 'Lose',
  'win.panel': 'Trail Complete',
  'fail.panel': 'Trail Blocked',
} as const;

/** The companion fail-balance text (a NON-semantic companion, not a carrier). */
export const FAIL_BALANCE_COPY = '25 Coins';

// Presentation colours lifted from the accepted Grapes P0 seed tokens
// (games/shell_proof_grapes/design/tokens.css) so the two lanes read alike.
const COLOR = {
  page: '#f7f6ef', // --fab-seed-color-surface
  header: '#e7eef0', // --fab-seed-color-secondary-surface
  hero: '#d7ecec', // --fab-seed-color-hero-surface
  gameplay: '#dceef0', // --fab-seed-color-gameplay-surface
  card: '#ffffff', // --fab-seed-color-shop-card-surface / modal card
  scrim: '#182a36', // --fab-seed-color-overlay-scrim base (alpha applied below)
  accent: '#14724f', // accessible green buttons / toggles (white contrast 5.9:1)
  accentDark: '#1f765d',
  accentSoft: '#d8eee4',
  cornflower: '#365f70',
  border: '#abc7cc',
  sun: '#ffeda2',
  hillNear: '#5da77f',
  hillFar: '#9bcfb1',
  path: '#f4e4b7',
  fail: '#a94f46',
  onAccent: '#ffffff', // --fab-seed-color-on-accent
  toggleThumb: '#ffffff', // --fab-toggle-thumb
  pauseSurface: '#fff6df', // --fab-seed-color-pause-surface
  pauseBorder: '#e9c980', // --fab-seed-color-pause-border
  currency: '#173042', // --fab-seed-color-currency-surface
  currencySecondary: '#2f6f59', // --fab-seed-color-currency-secondary-surface
  ink: '#173042',
  mutedInk: '#3d5968',
} as const;

const PAUSE_SCRIM_ALPHA = 0.42; // rgba(24,42,54,0.42)
const FONT = 'kenney_future';
const BODY_FONT = 'kenney_future_narrow';

export interface CompanionRect {
  kind: 'rect';
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  fillColor: string;
  fillAlpha?: number;
  rounded?: number;
  strokeColor?: string;
  strokeAlpha?: number;
  lineWidth?: number;
}

export interface CompanionImage {
  kind: 'image';
  id: string;
  name: string;
  x: number;
  y: number;
  textureKey: string;
  scaleX: number;
  scaleY: number;
  originX: number;
  originY: number;
  visible: boolean;
}

export interface CompanionText {
  kind: 'text';
  id: string;
  name: string;
  x: number;
  y: number;
  text: string;
  originX: number;
  originY: number;
  fontFamily: string;
  fontSize: string;
  color: string;
}

export type Companion = CompanionRect | CompanionImage | CompanionText;

export interface SemanticCopyEdit {
  semanticId: string;
  property: 'text';
  value: string;
}

export interface SemanticStyleEdit {
  semanticId: string;
  property: 'color' | 'fontFamily' | 'fontSize';
  value: string;
}

export interface SemanticGeometryEdit {
  semanticId: string;
  property: 'x' | 'y' | 'originX' | 'originY' | 'scaleX' | 'scaleY';
  value: number;
}

export interface SceneVisualPlan {
  /** Canonical scene file (e.g. `Menu.scene`). */
  scene: `${string}.scene`;
  /** Companions in back-to-front recipe order (index 0 renders furthest back). */
  companions: Companion[];
  /** Semantic copy updates applied via `SimpleOperation` (never new carriers). */
  semanticCopy: SemanticCopyEdit[];
  /** Contrast/fit changes applied to existing semantic Text carriers. */
  semanticStyle: SemanticStyleEdit[];
  /** Layout changes applied to existing semantic carriers. */
  semanticGeometry: SemanticGeometryEdit[];
}

// --- deterministic recipe builders (stable ids/names, no Semantic anything) ----

interface RectOpts {
  originX?: number;
  originY?: number;
  fillAlpha?: number;
  rounded?: number;
  strokeColor?: string;
  strokeAlpha?: number;
  lineWidth?: number;
}

function rect(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fillColor: string,
  opts: RectOpts = {},
): CompanionRect {
  return {
    kind: 'rect',
    id,
    name: id,
    x,
    y,
    width,
    height,
    originX: opts.originX ?? 0.5,
    originY: opts.originY ?? 0.5,
    fillColor,
    fillAlpha: opts.fillAlpha,
    rounded: opts.rounded,
    strokeColor: opts.strokeColor,
    strokeAlpha: opts.strokeAlpha,
    lineWidth: opts.lineWidth,
  };
}

function img(
  id: string,
  x: number,
  y: number,
  textureKey: string,
  scaleX: number,
  scaleY: number,
  originX: number,
  originY: number,
  visible = true,
): CompanionImage {
  return { kind: 'image', id, name: id, x, y, textureKey, scaleX, scaleY, originX, originY, visible };
}

interface TextOpts {
  originX?: number;
  originY?: number;
  fontFamily?: string;
  fontSize?: string;
  color?: string;
}

function text(id: string, x: number, y: number, value: string, opts: TextOpts = {}): CompanionText {
  return {
    kind: 'text',
    id,
    name: id,
    x,
    y,
    text: value,
    originX: opts.originX ?? 0.5,
    originY: opts.originY ?? 0.5,
    fontFamily: opts.fontFamily ?? FONT,
    fontSize: opts.fontSize ?? '22px',
    color: opts.color ?? COLOR.currency,
  };
}

const scrim = (id: string, alpha: number): CompanionRect =>
  rect(id, 195, 422, 390, 844, COLOR.scrim, { fillAlpha: alpha });
const backdrop = (id: string): CompanionRect =>
  rect(id, 195, 422, 390, 844, COLOR.page);

// The seven per-scene plans, in canonical scene order. Geometry targets the
// 390x844 editor border (centre x = 195); button surfaces and cards sit BEHIND
// their labels because every companion is forced behind the semantic carriers by
// display-list order (see the workbench operation below).
export const VISUAL_SEED: readonly SceneVisualPlan[] = [
  {
    scene: 'Menu.scene',
    companions: [
      backdrop('menu.fab.backdrop'),
      rect('menu.fab.header-band', 195, 1, 1, 1, COLOR.page, { fillAlpha: 0 }),
      rect('menu.fab.counter', 20, 34, 144, 56, COLOR.currency, {
        originX: 0, originY: 0, rounded: 28, strokeColor: COLOR.cornflower, strokeAlpha: 0.7, lineWidth: 2,
      }),
      text('menu.fab.balance', 108, 62, '25 Coins', {
        fontFamily: BODY_FONT, fontSize: '17px', color: COLOR.onAccent,
      }),
      text('menu.fab.subtitle', 195, 155, 'A small adventure begins here.', {
        fontFamily: BODY_FONT, fontSize: '16px', color: COLOR.mutedInk,
      }),
      rect('menu.fab.hero-card', 195, 300, 350, 210, COLOR.hero, {
        rounded: 28, strokeColor: COLOR.border, strokeAlpha: 1, lineWidth: 2,
      }),
      text('menu.fab.hero-label', 48, 242, 'TRAIL 2', {
        originX: 0, fontFamily: BODY_FONT, fontSize: '16px', color: COLOR.mutedInk,
      }),
      text('menu.fab.hero-title', 48, 278, 'Find the next step', {
        originX: 0, fontFamily: BODY_FONT, fontSize: '20px', color: COLOR.ink,
      }),
      text('menu.fab.hero-copy', 48, 320, 'The trail is ready.', {
        originX: 0, fontFamily: BODY_FONT, fontSize: '16px', color: COLOR.mutedInk,
      }),
      rect('menu.fab.hero-sun', 318, 238, 48, 48, COLOR.sun, { rounded: 24 }),
      rect('menu.fab.hero-hill-far', 274, 358, 150, 54, COLOR.hillFar, { rounded: 27 }),
      rect('menu.fab.hero-hill-near', 310, 362, 86, 54, COLOR.hillNear, { rounded: 27 }),
      rect('menu.fab.hero-path', 260, 357, 30, 56, COLOR.path, { rounded: 15 }),
      // Retire the pre-P1 decorative node in-place. The visual seed is an
      // idempotent upsert, so explicit inert values keep old scene bytes from
      // surviving a recipe revision without adding a deletion side channel.
      rect('menu.fab.hero-node-halo', 1, 1, 1, 1, COLOR.page, { fillAlpha: 0 }),
      img('menu.fab.hero-node', 1, 1, 'progression_node_current', 0.01, 0.01, 0.5, 0.5, false),
      rect('menu.fab.hero-flag-pole', 309, 286, 6, 78, COLOR.accentDark, { rounded: 3 }),
      rect('menu.fab.hero-flag', 326, 260, 40, 28, COLOR.accent, { rounded: 7 }),
      rect('menu.fab.progression-card', 195, 560, 350, 220, COLOR.card, {
        rounded: 28, strokeColor: COLOR.border, strokeAlpha: 0.8, lineWidth: 2,
      }),
      rect('menu.fab.progress-path-left', 148, 569, 94, 8, COLOR.accent, { rounded: 4 }),
      rect('menu.fab.progress-path-right', 242, 569, 94, 8, COLOR.accentSoft, { rounded: 4 }),
      rect('menu.fab.node-completed-surface', 101, 557, 64, 64, '#72b58e', { rounded: 32 }),
      img('menu.fab.node-completed-icon', 101, 557, 'icon_control_confirm', 0.36, 0.36, 0.5, 0.5),
      rect('menu.fab.node-current-halo', 195, 591, 76, 76, COLOR.accentSoft, { rounded: 38 }),
      text('menu.fab.node-current-label', 195, 632, 'CURRENT · 2', {
        fontFamily: BODY_FONT, fontSize: '16px', color: COLOR.accentDark,
      }),
      rect('menu.fab.node-locked-surface', 289, 557, 64, 64, '#77939c', { rounded: 32 }),
      text('menu.fab.progress-copy', 195, 654, 'TRAIL PROGRESS', {
        fontFamily: BODY_FONT, fontSize: '16px', color: COLOR.accentDark,
      }),
      rect('menu.fab.dock', 195, 844, 390, 144, COLOR.card, { originY: 1 }),
      rect('menu.fab.shop-shadow', 63, 762, 104, 86, COLOR.ink, { rounded: 20, fillAlpha: 0.14 }),
      rect('menu.fab.play-shadow', 195, 758, 154, 94, COLOR.ink, { rounded: 24, fillAlpha: 0.14 }),
      rect('menu.fab.settings-shadow', 327, 762, 104, 86, COLOR.ink, { rounded: 20, fillAlpha: 0.14 }),
      rect('menu.fab.shop-control', 63, 758, 104, 86, COLOR.cornflower, {
        rounded: 20, strokeColor: COLOR.accentDark, strokeAlpha: 0.55, lineWidth: 2,
      }),
      rect('menu.fab.play-control', 195, 754, 154, 94, COLOR.accent, { rounded: 24 }),
      rect('menu.fab.settings-control', 327, 758, 104, 86, COLOR.cornflower, {
        rounded: 20, strokeColor: COLOR.accentDark, strokeAlpha: 0.55, lineWidth: 2,
      }),
      img('menu.fab.play-surface', 195, 798, 'button_surface_primary', 0.01, 0.01, 0.5, 1, false),
      img('menu.fab.shop-surface', 100, 730, 'icon_control_surface', 0.01, 0.01, 1, 0, false),
      img('menu.fab.settings-surface', 346, 730, 'icon_control_surface', 0.01, 0.01, 1, 0, false),
      img('menu.fab.play-icon', 195, 744, 'icon_control_play', 0.4, 0.4, 0.5, 0.5),
      text('menu.fab.shop-label', 63, 788, 'Shop', {
        fontFamily: BODY_FONT, fontSize: '14px', color: COLOR.onAccent,
      }),
      text('menu.fab.settings-label', 327, 788, 'Settings', {
        fontFamily: BODY_FONT, fontSize: '14px', color: COLOR.onAccent,
      }),
    ],
    semanticCopy: [
      { semanticId: 'menu.title', property: 'text', value: SAMPLE_COPY['menu.title'] },
    ],
    semanticStyle: [
      { semanticId: 'menu.title', property: 'color', value: COLOR.ink },
      { semanticId: 'menu.title', property: 'fontFamily', value: FONT },
      { semanticId: 'menu.title', property: 'fontSize', value: '24px' },
      { semanticId: 'menu.play', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'menu.play', property: 'fontSize', value: '18px' },
    ],
    semanticGeometry: [
      { semanticId: 'menu.title', property: 'y', value: 116 },
      { semanticId: 'menu.currency', property: 'x', value: 28 },
      { semanticId: 'menu.currency', property: 'y', value: 44 },
      { semanticId: 'menu.currency', property: 'scaleX', value: 0.36 },
      { semanticId: 'menu.currency', property: 'scaleY', value: 0.36 },
      { semanticId: 'menu.shop', property: 'x', value: 83 },
      { semanticId: 'menu.shop', property: 'y', value: 738 },
      { semanticId: 'menu.shop', property: 'scaleX', value: 0.4 },
      { semanticId: 'menu.shop', property: 'scaleY', value: 0.4 },
      { semanticId: 'menu.shop', property: 'originX', value: 1 },
      { semanticId: 'menu.shop', property: 'originY', value: 0 },
      { semanticId: 'menu.play', property: 'y', value: 786 },
      { semanticId: 'menu.play', property: 'originY', value: 1 },
      { semanticId: 'menu.settings', property: 'x', value: 347 },
      { semanticId: 'menu.settings', property: 'y', value: 738 },
      { semanticId: 'menu.settings', property: 'scaleX', value: 0.4 },
      { semanticId: 'menu.settings', property: 'scaleY', value: 0.4 },
      { semanticId: 'menu.settings', property: 'originX', value: 1 },
      { semanticId: 'menu.settings', property: 'originY', value: 0 },
      { semanticId: 'menu.node.completed', property: 'scaleX', value: 0.01 },
      { semanticId: 'menu.node.completed', property: 'scaleY', value: 0.01 },
      { semanticId: 'menu.node.current', property: 'scaleX', value: 0.45703125 },
      { semanticId: 'menu.node.current', property: 'scaleY', value: 0.5275 },
      { semanticId: 'menu.node.locked', property: 'scaleX', value: 0.42 },
      { semanticId: 'menu.node.locked', property: 'scaleY', value: 0.42 },
    ],
  },
  {
    scene: 'Level.scene',
    companions: [
      backdrop('level.fab.backdrop'),
      rect('level.fab.header-band', 195, 52, 390, 104, COLOR.header),
      rect('level.fab.counter', 16, 28, 120, 48, COLOR.currency, { originX: 0, originY: 0, rounded: 24 }),
      text('level.fab.balance', 92, 52, '25 Coins', {
        fontFamily: BODY_FONT, fontSize: '14px', color: COLOR.onAccent,
      }),
      rect('level.fab.gameplay-card', 195, 394, 350, 540, COLOR.gameplay, {
        rounded: 28, strokeColor: COLOR.border, strokeAlpha: 1, lineWidth: 2,
      }),
      rect('level.fab.sun', 304, 208, 50, 50, COLOR.sun, { rounded: 25 }),
      rect('level.fab.hill-far', 118, 566, 190, 86, COLOR.hillFar, { rounded: 43 }),
      rect('level.fab.hill-near', 284, 550, 168, 118, COLOR.hillNear, { rounded: 58 }),
      text('level.fab.gameplay-label', 48, 170, 'TRAIL CLEARING', {
        originX: 0, fontFamily: BODY_FONT, fontSize: '14px', color: COLOR.accentDark,
      }),
      text('level.fab.gameplay-title', 48, 202, 'Find the next step', {
        originX: 0, fontFamily: FONT, fontSize: '20px', color: COLOR.ink,
      }),
      text('level.fab.gameplay-copy', 48, 236, 'A calm path opens ahead.', {
        originX: 0, fontFamily: BODY_FONT, fontSize: '15px', color: COLOR.mutedInk,
      }),
      rect('level.fab.path-a', 130, 490, 110, 10, COLOR.path, { rounded: 5 }),
      rect('level.fab.path-b', 185, 450, 10, 90, COLOR.path, { rounded: 5 }),
      rect('level.fab.path-c', 240, 410, 120, 10, COLOR.path, { rounded: 5 }),
      rect('level.fab.marker-start', 75, 490, 54, 54, '#72b58e', { rounded: 27 }),
      img('level.fab.marker-start-icon', 75, 490, 'icon_control_confirm', 0.3, 0.3, 0.5, 0.5),
      rect('level.fab.marker-current-halo', 185, 450, 66, 66, COLOR.accentSoft, { rounded: 33 }),
      img('level.fab.marker-current', 185, 450, 'progression_node_current', 0.34, 0.34, 0.5, 0.5),
      rect('level.fab.marker-goal', 300, 410, 54, 54, COLOR.accentDark, { rounded: 27 }),
      img('level.fab.marker-goal-icon', 300, 410, 'icon_control_result_win', 0.3, 0.3, 0.5, 0.5),
      rect('level.fab.pause-control', 354, 52, 48, 48, COLOR.cornflower, { rounded: 16 }),
      img('level.fab.pause-surface', 374.4, 52, 'icon_control_surface', 0.01, 0.01, 1, 0, false),
      text('level.fab.outcome-label', 195, 708, 'CHOOSE OUTCOME', {
        fontFamily: BODY_FONT, fontSize: '14px', color: COLOR.mutedInk,
      }),
      rect('level.fab.test-win-control', 96, 772, 160, 56, COLOR.accent, { rounded: 18 }),
      rect('level.fab.test-lose-control', 294, 772, 160, 56, COLOR.fail, {
        rounded: 18, strokeColor: COLOR.fail, strokeAlpha: 1, lineWidth: 2,
      }),
      img('level.fab.test-win-surface', 8, 804, 'button_surface_test_win', 0.01, 0.01, 0, 1, false),
      img('level.fab.test-lose-surface', 382, 804, 'button_surface_test_lose', 0.01, 0.01, 1, 1, false),
    ],
    semanticCopy: [
      { semanticId: 'level.label', property: 'text', value: SAMPLE_COPY['level.label'] },
      { semanticId: 'level.test-win', property: 'text', value: SAMPLE_COPY['level.test-win'] },
      { semanticId: 'level.test-lose', property: 'text', value: SAMPLE_COPY['level.test-lose'] },
    ],
    semanticStyle: [
      { semanticId: 'level.label', property: 'color', value: COLOR.ink },
      { semanticId: 'level.label', property: 'fontFamily', value: FONT },
      { semanticId: 'level.label', property: 'fontSize', value: '22px' },
      { semanticId: 'level.test-win', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'level.test-win', property: 'fontSize', value: '15px' },
      { semanticId: 'level.test-lose', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'level.test-lose', property: 'fontSize', value: '15px' },
      { semanticId: 'level.test-lose', property: 'color', value: COLOR.onAccent },
    ],
    semanticGeometry: [
      { semanticId: 'level.currency', property: 'x', value: 24 },
      { semanticId: 'level.currency', property: 'y', value: 38 },
      { semanticId: 'level.currency', property: 'scaleX', value: 0.28 },
      { semanticId: 'level.currency', property: 'scaleY', value: 0.28 },
      { semanticId: 'level.label', property: 'x', value: 195 },
      { semanticId: 'level.label', property: 'y', value: 52 },
      { semanticId: 'level.pause', property: 'x', value: 372 },
      { semanticId: 'level.pause', property: 'y', value: 34 },
      { semanticId: 'level.pause', property: 'scaleX', value: 0.36 },
      { semanticId: 'level.pause', property: 'scaleY', value: 0.36 },
      { semanticId: 'level.test-win', property: 'x', value: 36 },
      { semanticId: 'level.test-win', property: 'y', value: 792 },
      { semanticId: 'level.test-win', property: 'originX', value: 0 },
      { semanticId: 'level.test-win', property: 'originY', value: 1 },
      { semanticId: 'level.test-lose', property: 'x', value: 354 },
      { semanticId: 'level.test-lose', property: 'y', value: 792 },
      { semanticId: 'level.test-lose', property: 'originX', value: 1 },
      { semanticId: 'level.test-lose', property: 'originY', value: 1 },
    ],
  },
  {
    scene: 'Shop.scene',
    companions: [
      backdrop('shop.fab.backdrop'),
      rect('shop.fab.header-band', 195, 1, 1, 1, COLOR.page, { fillAlpha: 0 }),
      rect('shop.fab.counter-primary', 16, 108, 172, 56, COLOR.currency, {
        originX: 0, originY: 0, rounded: 28, strokeColor: COLOR.cornflower, strokeAlpha: 0.65, lineWidth: 2,
      }),
      rect('shop.fab.counter-secondary', 202, 108, 172, 56, COLOR.currencySecondary, {
        originX: 0, originY: 0, rounded: 28, strokeColor: COLOR.hillFar, strokeAlpha: 0.65, lineWidth: 2,
      }),
      rect('shop.fab.grid-card', 195, 1, 1, 1, COLOR.page, { fillAlpha: 0 }),
      text('shop.fab.section-title', 24, 202, 'TRAIL SUPPLIES', {
        originX: 0, fontFamily: BODY_FONT, fontSize: '20px', color: COLOR.ink,
      }),
      rect('shop.fab.item-available-shadow', 104, 330, 160, 176, COLOR.ink, {
        rounded: 20, fillAlpha: 0.12,
      }),
      rect('shop.fab.item-owned-shadow', 286, 330, 160, 176, COLOR.ink, {
        rounded: 20, fillAlpha: 0.12,
      }),
      // Retire the third/VIP card in place. The visual seed is an idempotent
      // Editor upsert, so every previously persisted object must receive an
      // explicit inert value or an older scene can keep rendering it.
      rect('shop.fab.item-locked-shadow', 1, 1, 1, 1, COLOR.page, { fillAlpha: 0 }),
      rect('shop.fab.item-available-card', 104, 326, 160, 176, '#fff1c7', {
        rounded: 20,
      }),
      rect('shop.fab.item-owned-card', 286, 326, 160, 176, COLOR.accentSoft, {
        rounded: 20,
      }),
      rect('shop.fab.item-locked-card', 1, 1, 1, 1, COLOR.page, {
        fillAlpha: 0, strokeColor: COLOR.page, strokeAlpha: 0, lineWidth: 0,
      }),
      rect('shop.fab.item-fourth-card', 1, 1, 1, 1, COLOR.page, { fillAlpha: 0 }),
      text('shop.fab.item-fourth-label', 1, 1, ' ', {
        fontFamily: BODY_FONT, fontSize: '14px', color: COLOR.page,
      }),
      rect('shop.fab.back-control', 44, 60, 56, 56, COLOR.accent, { rounded: 18 }),
      img('shop.fab.back-surface', 15.6, 52, 'icon_control_surface', 0.01, 0.01, 0, 0, false),
      img('shop.fab.back-glyph', 44, 60, 'icon_control_return', 0.38, 0.38, 0.5, 0.5),
      text('shop.fab.primary-balance', 127, 136, '25 Coins', {
        fontFamily: BODY_FONT, fontSize: '16px', color: COLOR.onAccent,
      }),
      text('shop.fab.secondary-gem', 224, 136, '◆', {
        fontFamily: BODY_FONT, fontSize: '23px', color: COLOR.onAccent,
      }),
      text('shop.fab.secondary-balance', 316, 136, '12 Gems', {
        fontFamily: BODY_FONT, fontSize: '16px', color: COLOR.onAccent,
      }),
      rect('shop.fab.item-available-coin-left', 88, 279, 30, 30, COLOR.sun, { rounded: 15 }),
      rect('shop.fab.item-available-coin-right', 120, 279, 30, 30, '#f1c75b', { rounded: 15 }),
      rect('shop.fab.item-available-icon-surface', 104, 270, 38, 38, COLOR.currency, { rounded: 19 }),
      img('shop.fab.item-available-icon', 104, 270, 'counter_frame_primary_currency', 0.24, 0.24, 0.5, 0.5),
      text('shop.fab.item-available-detail', 104, 351, '500 Coins', {
        fontFamily: BODY_FONT, fontSize: '15px', color: COLOR.mutedInk,
      }),
      rect('shop.fab.item-available-price-surface', 104, 386, 132, 48, COLOR.accent, { rounded: 16 }),
      text('shop.fab.item-available-price', 104, 386, 'PREVIEW', {
        fontFamily: BODY_FONT, fontSize: '14px', color: COLOR.onAccent,
      }),
      rect('shop.fab.item-owned-ad-tile', 286, 280, 58, 48, COLOR.card, { rounded: 12 }),
      // Retire two companions from the earlier shop recipe. Explicit inert
      // upserts prevent removed recipe objects surviving in Editor authority.
      rect('shop.fab.item-owned-icon-surface', 1, 1, 1, 1, COLOR.page, { fillAlpha: 0 }),
      text('shop.fab.item-owned-ad-label', 286, 280, 'AD', {
        fontFamily: FONT, fontSize: '15px', color: COLOR.ink,
      }),
      img('shop.fab.item-owned-icon', 306, 262, 'icon_control_confirm', 0.22, 0.22, 0.5, 0.5),
      text('shop.fab.item-owned-detail', 1, 1, ' ', {
        fontFamily: BODY_FONT, fontSize: '15px', color: COLOR.page,
      }),
      rect('shop.fab.item-owned-status-surface', 286, 386, 132, 48, '#bddbcb', { rounded: 16 }),
      text('shop.fab.item-owned-status', 286, 386, 'OWNED', {
        fontFamily: BODY_FONT, fontSize: '14px', color: COLOR.accentDark,
      }),
      rect('shop.fab.item-locked-trophy', 1, 1, 1, 1, COLOR.page, { fillAlpha: 0 }),
      rect('shop.fab.item-locked-icon-surface', 1, 1, 1, 1, COLOR.page, { fillAlpha: 0 }),
      img('shop.fab.item-locked-trophy-icon', 1, 1, 'icon_control_result_win', 0.01, 0.01, 0.5, 0.5, false),
      text('shop.fab.item-locked-detail', 1, 1, ' ', {
        fontFamily: BODY_FONT, fontSize: '15px', color: COLOR.page,
      }),
      rect('shop.fab.item-locked-status-surface', 1, 1, 1, 1, COLOR.page, {
        fillAlpha: 0, strokeColor: COLOR.page, strokeAlpha: 0, lineWidth: 0,
      }),
      text('shop.fab.item-locked-status', 1, 1, ' ', {
        fontFamily: BODY_FONT, fontSize: '14px', color: COLOR.page,
      }),
      rect('shop.fab.restore-card', 195, 742, 350, 148, COLOR.card, {
        rounded: 22, strokeColor: COLOR.border, strokeAlpha: 1, lineWidth: 2,
      }),
      text('shop.fab.restore-title', 42, 688, 'Purchases', {
        originX: 0, fontFamily: BODY_FONT, fontSize: '17px', color: COLOR.ink,
      }),
      text('shop.fab.restore-copy', 42, 714, 'Restore previous purchases.', {
        originX: 0, fontFamily: BODY_FONT, fontSize: '15px', color: COLOR.mutedInk,
      }),
      rect('shop.fab.restore-control', 195, 775, 318, 54, COLOR.accent, { rounded: 20 }),
      img('shop.fab.restore-surface', 195, 790, 'button_surface_secondary', 0.01, 0.01, 0.5, 1, false),
    ],
    semanticCopy: [
      { semanticId: 'shop.item.available', property: 'text', value: SHOP_COPY['shop.item.available'] },
      { semanticId: 'shop.item.owned', property: 'text', value: SHOP_COPY['shop.item.owned'] },
      { semanticId: 'shop.item.locked', property: 'text', value: SHOP_COPY['shop.item.locked'] },
      { semanticId: 'shop.restore', property: 'text', value: SHOP_COPY['shop.restore'] },
    ],
    semanticStyle: [
      { semanticId: 'shop.title', property: 'color', value: COLOR.ink },
      { semanticId: 'shop.title', property: 'fontFamily', value: FONT },
      { semanticId: 'shop.item.available', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'shop.item.available', property: 'fontSize', value: '18px' },
      { semanticId: 'shop.item.available', property: 'color', value: COLOR.ink },
      { semanticId: 'shop.item.owned', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'shop.item.owned', property: 'fontSize', value: '18px' },
      { semanticId: 'shop.item.owned', property: 'color', value: COLOR.ink },
      { semanticId: 'shop.item.locked', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'shop.item.locked', property: 'fontSize', value: '18px' },
      { semanticId: 'shop.item.locked', property: 'color', value: COLOR.page },
      { semanticId: 'shop.restore', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'shop.restore', property: 'fontSize', value: '17px' },
    ],
    semanticGeometry: [
      { semanticId: 'shop.title', property: 'y', value: 40 },
      { semanticId: 'shop.back', property: 'x', value: 20 },
      { semanticId: 'shop.back', property: 'y', value: 36 },
      { semanticId: 'shop.back', property: 'scaleX', value: 0.01 },
      { semanticId: 'shop.back', property: 'scaleY', value: 0.01 },
      { semanticId: 'shop.currency', property: 'x', value: 24 },
      { semanticId: 'shop.currency', property: 'y', value: 118 },
      { semanticId: 'shop.currency', property: 'scaleX', value: 0.32 },
      { semanticId: 'shop.currency', property: 'scaleY', value: 0.32 },
      { semanticId: 'shop.currency.secondary', property: 'x', value: 212 },
      { semanticId: 'shop.currency.secondary', property: 'y', value: 118 },
      { semanticId: 'shop.currency.secondary', property: 'scaleX', value: 0.01 },
      { semanticId: 'shop.currency.secondary', property: 'scaleY', value: 0.01 },
      { semanticId: 'shop.item.available', property: 'x', value: 104 },
      { semanticId: 'shop.item.available', property: 'y', value: 321 },
      { semanticId: 'shop.item.owned', property: 'x', value: 286 },
      { semanticId: 'shop.item.owned', property: 'y', value: 321 },
      // Keep the schema carrier inside representable bounds while making it
      // blank, page-coloured, and effectively zero-sized.
      { semanticId: 'shop.item.locked', property: 'x', value: 195 },
      { semanticId: 'shop.item.locked', property: 'y', value: 526 },
      { semanticId: 'shop.item.locked', property: 'scaleX', value: 0.01 },
      { semanticId: 'shop.item.locked', property: 'scaleY', value: 0.01 },
      { semanticId: 'shop.restore', property: 'y', value: 786 },
      { semanticId: 'shop.restore', property: 'originY', value: 1 },
    ],
  },
  {
    scene: 'Settings.scene',
    companions: [
      backdrop('settings.fab.backdrop'),
      rect('settings.fab.header-band', 195, 1, 1, 1, COLOR.page, { fillAlpha: 0 }),
      rect('settings.fab.panel', 195, 366, 350, 360, COLOR.card, {
        rounded: 26, strokeColor: COLOR.border, strokeAlpha: 1, lineWidth: 2,
      }),
      rect('settings.fab.back-control', 44, 60, 56, 56, COLOR.accent, { rounded: 18 }),
      img('settings.fab.back-surface', 15.6, 52, 'icon_control_surface', 0.01, 0.01, 0, 0, false),
      img('settings.fab.back-glyph', 44, 60, 'icon_control_return', 0.38, 0.38, 0.5, 0.5),
      text('settings.fab.section-copy', 195, 158, 'Sound and feel', {
        fontFamily: BODY_FONT, fontSize: '15px', color: COLOR.mutedInk,
      }),
      rect('settings.fab.divider-music', 195, 329, 300, 2, COLOR.header),
      rect('settings.fab.divider-sfx', 195, 414, 300, 2, COLOR.header),
      // Three green toggle switches (track + thumb), one per settings row.
      rect('settings.fab.toggle-music-track', 322, 286.96, 58, 30, COLOR.accent, { rounded: 15 }),
      rect('settings.fab.toggle-music-thumb', 338, 286.96, 22, 22, COLOR.toggleThumb, { rounded: 11 }),
      rect('settings.fab.toggle-sfx-track', 322, 371.36, 58, 30, COLOR.accent, { rounded: 15 }),
      rect('settings.fab.toggle-sfx-thumb', 338, 371.36, 22, 22, COLOR.toggleThumb, { rounded: 11 }),
      rect('settings.fab.toggle-haptics-track', 322, 455.76, 58, 30, COLOR.accent, { rounded: 15 }),
      rect('settings.fab.toggle-haptics-thumb', 338, 455.76, 22, 22, COLOR.toggleThumb, { rounded: 11 }),
    ],
    semanticCopy: [],
    semanticStyle: [
      { semanticId: 'settings.title', property: 'color', value: COLOR.ink },
      { semanticId: 'settings.title', property: 'fontFamily', value: FONT },
      { semanticId: 'settings.music', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'settings.music', property: 'fontSize', value: '20px' },
      { semanticId: 'settings.music', property: 'color', value: COLOR.ink },
      { semanticId: 'settings.sfx', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'settings.sfx', property: 'fontSize', value: '20px' },
      { semanticId: 'settings.sfx', property: 'color', value: COLOR.ink },
      { semanticId: 'settings.haptics', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'settings.haptics', property: 'fontSize', value: '20px' },
      { semanticId: 'settings.haptics', property: 'color', value: COLOR.ink },
    ],
    semanticGeometry: [
      { semanticId: 'settings.title', property: 'y', value: 40 },
      { semanticId: 'settings.back', property: 'x', value: 20 },
      { semanticId: 'settings.back', property: 'y', value: 36 },
      { semanticId: 'settings.back', property: 'scaleX', value: 0.01 },
      { semanticId: 'settings.back', property: 'scaleY', value: 0.01 },
      { semanticId: 'settings.music', property: 'x', value: 160 },
      { semanticId: 'settings.sfx', property: 'x', value: 160 },
      { semanticId: 'settings.haptics', property: 'x', value: 160 },
    ],
  },
  {
    scene: 'Pause.scene',
    companions: [
      backdrop('pause.fab.backdrop'),
      rect('pause.fab.gameplay-card', 195, 370, 350, 610, COLOR.gameplay, { rounded: 28 }),
      rect('pause.fab.gameplay-sun', 303, 190, 48, 48, COLOR.sun, { rounded: 24 }),
      rect('pause.fab.gameplay-hill', 264, 600, 200, 112, COLOR.hillNear, { rounded: 56 }),
      scrim('pause.fab.scrim', PAUSE_SCRIM_ALPHA),
      rect('pause.fab.card', 195, 454, 340, 510, COLOR.pauseSurface, {
        rounded: 28,
        strokeColor: COLOR.accentDark,
        strokeAlpha: 1,
        lineWidth: 2,
      }),
      rect('pause.fab.handle', 195, 222, 48, 5, COLOR.accentDark, { rounded: 3, fillAlpha: 0.6 }),
      text('pause.fab.explainer', 195, 344, 'Your run is safe.', {
        fontFamily: BODY_FONT, fontSize: '15px', color: COLOR.mutedInk,
      }),
      rect('pause.fab.resume-control', 195, 478, 292, 62, COLOR.accent, { rounded: 20 }),
      rect('pause.fab.settings-control', 195, 564, 292, 62, COLOR.accentSoft, {
        rounded: 20, strokeColor: COLOR.accentDark, strokeAlpha: 1, lineWidth: 2,
      }),
      rect('pause.fab.home-control', 195, 650, 292, 62, COLOR.card, {
        rounded: 20, strokeColor: COLOR.border, strokeAlpha: 1, lineWidth: 2,
      }),
      img('pause.fab.resume-surface', 195, 607.68, 'button_surface_primary', 0.01, 0.01, 0.5, 1, false),
      img('pause.fab.settings-surface', 195, 692.08, 'button_surface_secondary', 0.01, 0.01, 0.5, 1, false),
      img('pause.fab.home-surface', 195, 776.48, 'button_surface_secondary', 0.01, 0.01, 0.5, 1, false),
    ],
    semanticCopy: [],
    semanticStyle: [
      { semanticId: 'pause.panel', property: 'color', value: COLOR.ink },
      { semanticId: 'pause.panel', property: 'fontFamily', value: FONT },
      { semanticId: 'pause.resume', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'pause.resume', property: 'fontSize', value: '20px' },
      { semanticId: 'pause.settings', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'pause.settings', property: 'fontSize', value: '20px' },
      { semanticId: 'pause.settings', property: 'color', value: COLOR.ink },
      { semanticId: 'pause.home', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'pause.home', property: 'fontSize', value: '20px' },
      { semanticId: 'pause.home', property: 'color', value: COLOR.ink },
    ],
    semanticGeometry: [
      { semanticId: 'pause.panel', property: 'y', value: 290 },
      { semanticId: 'pause.resume', property: 'y', value: 492 },
      { semanticId: 'pause.resume', property: 'originY', value: 1 },
      { semanticId: 'pause.settings', property: 'y', value: 578 },
      { semanticId: 'pause.settings', property: 'originY', value: 1 },
      { semanticId: 'pause.home', property: 'y', value: 664 },
      { semanticId: 'pause.home', property: 'originY', value: 1 },
    ],
  },
  {
    scene: 'Win.scene',
    companions: [
      backdrop('win.fab.backdrop'),
      rect('win.fab.gameplay-card', 195, 370, 350, 620, COLOR.gameplay, { rounded: 28 }),
      text('win.fab.context-level', 195, 84, 'TRAIL 2', { fontSize: '18px', color: COLOR.ink }),
      rect('win.fab.context-prompt', 195, 180, 300, 112, COLOR.card, {
        rounded: 22, strokeColor: COLOR.border, strokeAlpha: 1, lineWidth: 2,
      }),
      text('win.fab.context-eyebrow', 72, 154, 'NEXT STEP', {
        originX: 0, fontFamily: BODY_FONT, fontSize: '14px', color: COLOR.accentDark,
      }),
      text('win.fab.context-copy', 72, 194, 'A calm path opens ahead.', {
        originX: 0, fontFamily: BODY_FONT, fontSize: '15px', color: COLOR.ink,
      }),
      rect('win.fab.context-sun', 306, 318, 48, 48, COLOR.sun, { rounded: 24 }),
      rect('win.fab.context-hill', 278, 590, 188, 112, COLOR.hillNear, { rounded: 56 }),
      scrim('win.fab.scrim', 0.52),
      rect('win.fab.card', 195, 450, 354, 520, COLOR.pauseSurface, {
        rounded: 28, strokeColor: COLOR.accentDark, strokeAlpha: 0.8, lineWidth: 2,
      }),
      rect('win.fab.header-shadow', 1, 1, 1, 1, COLOR.page, { fillAlpha: 0 }),
      rect('win.fab.header', 1, 1, 1, 1, COLOR.page, { fillAlpha: 0 }),
      img('win.fab.result-icon-surface', 195, 170, 'icon_control_surface', 0.01, 0.01, 0.5, 0.5, false),
      rect('win.fab.result-medal', 195, 260, 56, 56, COLOR.accentDark, { rounded: 28 }),
      img('win.fab.result-icon', 195, 260, 'icon_control_result_win', 0.28, 0.28, 0.5, 0.5),
      rect('win.fab.confetti-a', 68, 278, 8, 18, COLOR.fail, { rounded: 4 }),
      rect('win.fab.confetti-b', 102, 340, 8, 14, COLOR.cornflower, { rounded: 4 }),
      rect('win.fab.confetti-c', 150, 270, 14, 8, COLOR.sun, { rounded: 4 }),
      rect('win.fab.confetti-d', 248, 272, 8, 16, COLOR.hillNear, { rounded: 4 }),
      rect('win.fab.confetti-e', 286, 356, 14, 8, COLOR.fail, { rounded: 4 }),
      rect('win.fab.confetti-f', 332, 258, 8, 14, COLOR.sun, { rounded: 4 }),
      rect('win.fab.reward-ribbon', 195, 425, 294, 110, COLOR.gameplay, {
        rounded: 22, strokeColor: COLOR.border, strokeAlpha: 1, lineWidth: 2,
      }),
      text('win.fab.explainer', 195, 457, 'A new route is ready.', {
        fontFamily: BODY_FONT, fontSize: '15px', color: COLOR.mutedInk,
      }),
      rect('win.fab.claim-control', 195, 526, 294, 60, COLOR.accent, { rounded: 20 }),
      rect('win.fab.claim-double-control', 195, 608, 294, 72, COLOR.accentSoft, {
        rounded: 20, strokeColor: COLOR.accentDark, strokeAlpha: 1, lineWidth: 2,
      }),
      rect('win.fab.claim-double-icon-surface', 74, 608, 40, 40, COLOR.accentDark, { rounded: 20 }),
      img('win.fab.claim-double-icon', 74, 608, 'icon_control_play', 0.26, 0.26, 0.5, 0.5),
      img('win.fab.claim-surface', 195, 650, 'button_surface_primary', 0.01, 0.01, 0.5, 1, false),
      img('win.fab.claim-double-surface', 195, 738, 'button_surface_secondary', 0.01, 0.01, 0.5, 1, false),
    ],
    // win.next / win.home stay hidden (visible:false); we never touch them.
    semanticCopy: [
      { semanticId: 'win.panel', property: 'text', value: SAMPLE_COPY['win.panel'] },
      { semanticId: 'win.reward', property: 'text', value: RESULT_COPY['win.reward'] },
      { semanticId: 'win.claim-double', property: 'text', value: RESULT_COPY['win.claim-double'] },
    ],
    semanticStyle: [
      { semanticId: 'win.panel', property: 'color', value: COLOR.ink },
      { semanticId: 'win.panel', property: 'fontFamily', value: FONT },
      { semanticId: 'win.panel', property: 'fontSize', value: '22px' },
      { semanticId: 'win.reward', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'win.reward', property: 'fontSize', value: '20px' },
      { semanticId: 'win.reward', property: 'color', value: COLOR.ink },
      { semanticId: 'win.claim', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'win.claim', property: 'fontSize', value: '20px' },
      { semanticId: 'win.claim-double', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'win.claim-double', property: 'fontSize', value: '14px' },
      { semanticId: 'win.claim-double', property: 'color', value: COLOR.ink },
    ],
    semanticGeometry: [
      { semanticId: 'win.panel', property: 'x', value: 195 },
      { semanticId: 'win.panel', property: 'y', value: 330 },
      { semanticId: 'win.reward', property: 'y', value: 399 },
      { semanticId: 'win.reward', property: 'originY', value: 0 },
      { semanticId: 'win.claim', property: 'y', value: 540 },
      { semanticId: 'win.claim', property: 'originY', value: 1 },
      { semanticId: 'win.claim-double', property: 'x', value: 218 },
      { semanticId: 'win.claim-double', property: 'y', value: 619 },
      { semanticId: 'win.claim-double', property: 'originY', value: 1 },
    ],
  },
  {
    scene: 'Fail.scene',
    companions: [
      backdrop('fail.fab.backdrop'),
      rect('fail.fab.gameplay-card', 195, 370, 350, 620, COLOR.gameplay, { rounded: 28 }),
      text('fail.fab.context-level', 195, 84, 'TRAIL 2', { fontSize: '18px', color: COLOR.ink }),
      rect('fail.fab.context-prompt', 195, 180, 300, 112, COLOR.card, {
        rounded: 22, strokeColor: COLOR.border, strokeAlpha: 1, lineWidth: 2,
      }),
      text('fail.fab.context-eyebrow', 72, 154, 'TRAIL CLEARING', {
        originX: 0, fontFamily: BODY_FONT, fontSize: '14px', color: COLOR.accentDark,
      }),
      text('fail.fab.context-copy', 72, 194, 'A calm path opens ahead.', {
        originX: 0, fontFamily: BODY_FONT, fontSize: '15px', color: COLOR.ink,
      }),
      rect('fail.fab.context-sun', 306, 318, 48, 48, COLOR.sun, { rounded: 24 }),
      rect('fail.fab.context-hill', 278, 590, 188, 112, COLOR.hillNear, { rounded: 56 }),
      scrim('fail.fab.scrim', 0.52),
      rect('fail.fab.card', 195, 844, 390, 454, COLOR.pauseSurface, {
        originY: 1, rounded: 28, strokeColor: COLOR.fail, strokeAlpha: 1, lineWidth: 2,
      }),
      rect('fail.fab.handle', 195, 402, 48, 5, COLOR.fail, { rounded: 3 }),
      rect('fail.fab.header-shadow', 1, 1, 1, 1, COLOR.page, { fillAlpha: 0 }),
      rect('fail.fab.header', 1, 1, 1, 1, COLOR.page, { fillAlpha: 0 }),
      rect('fail.fab.result-medal', 346, 438, 56, 56, COLOR.fail, { rounded: 28 }),
      img('fail.fab.result-icon', 346, 438, 'icon_control_result_fail', 0.3, 0.3, 0.5, 0.5),
      rect('fail.fab.counter', 85, 490, 220, 56, COLOR.currency, {
        originX: 0, originY: 0, rounded: 28, strokeColor: COLOR.cornflower, strokeAlpha: 0.65, lineWidth: 2,
      }),
      text('fail.fab.balance', 222, 518, FAIL_BALANCE_COPY, {
        fontFamily: BODY_FONT, fontSize: '18px', color: COLOR.onAccent,
      }),
      text('fail.fab.explainer', 195, 568, 'Choose a step and retry.', {
        fontFamily: BODY_FONT, fontSize: '15px', color: COLOR.mutedInk,
      }),
      rect('fail.fab.continue-control', 195, 628, 338, 60, COLOR.accent, { rounded: 20 }),
      rect('fail.fab.retry-control', 195, 698, 338, 58, COLOR.accentSoft, {
        rounded: 20, strokeColor: COLOR.accentDark, strokeAlpha: 1, lineWidth: 2,
      }),
      rect('fail.fab.bundle-divider', 195, 739, 306, 2, COLOR.fail, { fillAlpha: 0.4 }),
      rect('fail.fab.bundle-control', 195, 781, 306, 58, '#f7ded4', {
        rounded: 20,
      }),
      img('fail.fab.retry-surface', 195, 727, 'button_surface_primary', 0.01, 0.01, 0.5, 1, false),
      img('fail.fab.continue-surface', 195, 658, 'button_surface_secondary', 0.01, 0.01, 0.5, 1, false),
      img('fail.fab.bundle-surface', 195, 824, 'button_surface_secondary', 0.01, 0.01, 0.5, 1, false),
    ],
    semanticCopy: [
      { semanticId: 'fail.panel', property: 'text', value: SAMPLE_COPY['fail.panel'] },
      { semanticId: 'fail.continue-coins', property: 'text', value: RESULT_COPY['fail.continue-coins'] },
      { semanticId: 'fail.bundle', property: 'text', value: RESULT_COPY['fail.bundle'] },
    ],
    semanticStyle: [
      { semanticId: 'fail.panel', property: 'color', value: COLOR.ink },
      { semanticId: 'fail.panel', property: 'fontFamily', value: FONT },
      { semanticId: 'fail.panel', property: 'fontSize', value: '20px' },
      { semanticId: 'fail.continue-coins', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'fail.continue-coins', property: 'fontSize', value: '19px' },
      { semanticId: 'fail.bundle', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'fail.bundle', property: 'fontSize', value: '14px' },
      { semanticId: 'fail.bundle', property: 'color', value: COLOR.ink },
      { semanticId: 'fail.retry', property: 'fontFamily', value: BODY_FONT },
      { semanticId: 'fail.retry', property: 'fontSize', value: '20px' },
      { semanticId: 'fail.retry', property: 'color', value: COLOR.ink },
    ],
    semanticGeometry: [
      { semanticId: 'fail.panel', property: 'x', value: 195 },
      { semanticId: 'fail.panel', property: 'y', value: 438 },
      { semanticId: 'fail.currency', property: 'x', value: 98 },
      { semanticId: 'fail.currency', property: 'y', value: 504 },
      { semanticId: 'fail.currency', property: 'scaleX', value: 0.32 },
      { semanticId: 'fail.currency', property: 'scaleY', value: 0.32 },
      { semanticId: 'fail.continue-coins', property: 'y', value: 643 },
      { semanticId: 'fail.continue-coins', property: 'originY', value: 1 },
      { semanticId: 'fail.retry', property: 'y', value: 713 },
      { semanticId: 'fail.retry', property: 'originY', value: 1 },
      { semanticId: 'fail.bundle', property: 'y', value: 792 },
      { semanticId: 'fail.bundle', property: 'originY', value: 1 },
      { semanticId: 'fail.bundle', property: 'scaleX', value: 1 },
    ],
  },
];

/** The canonical scene files in the order the workbench opens + saves them. */
export const SEED_SCENE_ORDER: readonly string[] = SCENE_FILES;

/** Plan for a scene file, or undefined when the scene is not seeded. */
export function planForScene(scene: string): SceneVisualPlan | undefined {
  return VISUAL_SEED.find((plan) => plan.scene === scene);
}

/** Every companion across all seven scenes, in canonical scene + recipe order. */
export function allCompanions(): Companion[] {
  return VISUAL_SEED.flatMap((plan) => plan.companions);
}

/** Every semantic copy edit across all seven scenes, tagged with its scene. */
export function allSemanticCopyEdits(): Array<SemanticCopyEdit & { scene: string }> {
  return VISUAL_SEED.flatMap((plan) => plan.semanticCopy.map((edit) => ({ ...edit, scene: plan.scene })));
}

export function allSemanticStyleEdits(): Array<SemanticStyleEdit & { scene: string }> {
  return VISUAL_SEED.flatMap((plan) => plan.semanticStyle.map((edit) => ({ ...edit, scene: plan.scene })));
}

export function allSemanticGeometryEdits(): Array<SemanticGeometryEdit & { scene: string }> {
  return VISUAL_SEED.flatMap((plan) => plan.semanticGeometry.map((edit) => ({ ...edit, scene: plan.scene })));
}

/**
 * Translate a companion into the Editor 5.0.2 game-object data accepted by
 * `SceneMaker.createObject` (verified against the installed product.all.js:
 * Rectangle/Image/Text extensions + Shape/Size/Transform/Origin components). It
 * NEVER emits a `components` array or any `Semantic.*` key — the non-semantic
 * invariant is guaranteed here by construction, then re-asserted.
 */
export function companionObjData(companion: Companion): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: companion.id,
    label: companion.name,
    x: companion.x,
    y: companion.y,
    originX: companion.originX,
    originY: companion.originY,
  };
  if (companion.kind === 'rect') {
    base.type = 'Rectangle';
    base.width = companion.width;
    base.height = companion.height;
    base.isFilled = true;
    base.fillColor = companion.fillColor;
    if (companion.fillAlpha !== undefined) base.fillAlpha = companion.fillAlpha;
    if (companion.rounded !== undefined && companion.rounded > 0) base.rounded = companion.rounded;
    if (companion.strokeColor !== undefined) {
      base.isStroked = true;
      base.strokeColor = companion.strokeColor;
      if (companion.strokeAlpha !== undefined) base.strokeAlpha = companion.strokeAlpha;
      if (companion.lineWidth !== undefined) base.lineWidth = companion.lineWidth;
    }
  } else if (companion.kind === 'image') {
    base.type = 'Image';
    base.texture = { key: companion.textureKey };
    base.scaleX = companion.scaleX;
    base.scaleY = companion.scaleY;
    base.visible = companion.visible;
  } else {
    base.type = 'Text';
    base.text = companion.text;
    base.fontFamily = companion.fontFamily;
    base.fontSize = companion.fontSize;
    base.color = companion.color;
  }
  assertNonSemantic(base);
  return base;
}

/** Guard: companion data may never carry a Semantic component (by construction). */
function assertNonSemantic(objData: Record<string, unknown>): void {
  if ('components' in objData) {
    throw new VisualSeedBlocked('companion-has-components', 'a companion must not declare a components array');
  }
  for (const key of Object.keys(objData)) {
    if (key === 'Semantic' || key.startsWith('Semantic.')) {
      throw new VisualSeedBlocked('companion-semantic-key', `a companion must not carry ${key}`);
    }
  }
}

/**
 * Deterministic recipe invariants (pure; unit-testable without an Editor):
 *  - every companion id is unique and namespaced `<scene>.fab.*`;
 *  - no companion collides with a semantic id (caller passes the 48 ids);
 *  - every companion serialises to non-semantic Editor data;
 *  - every semantic copy edit targets one of the 48 carriers.
 */
export function assertSeedInvariants(semanticIds: ReadonlySet<string>): void {
  const seen = new Set<string>();
  for (const plan of VISUAL_SEED) {
    const prefix = `${plan.scene.replace(/\.scene$/, '').toLowerCase()}.fab.`;
    for (const companion of plan.companions) {
      if (seen.has(companion.id)) {
        throw new VisualSeedBlocked('duplicate-companion-id', `duplicate companion id ${companion.id}`);
      }
      seen.add(companion.id);
      if (!companion.id.startsWith(prefix)) {
        throw new VisualSeedBlocked('companion-id-namespace', `${companion.id} is not namespaced ${prefix}*`);
      }
      if (semanticIds.has(companion.id)) {
        throw new VisualSeedBlocked('companion-id-collision', `${companion.id} collides with a semantic id`);
      }
      companionObjData(companion); // re-asserts non-semantic
    }
    for (const edit of plan.semanticCopy) {
      if (!semanticIds.has(edit.semanticId)) {
        throw new VisualSeedBlocked('semantic-copy-target', `${edit.semanticId} is not a semantic carrier`);
      }
    }
    for (const edit of [...plan.semanticStyle, ...plan.semanticGeometry]) {
      if (!semanticIds.has(edit.semanticId)) {
        throw new VisualSeedBlocked('semantic-edit-target', `${edit.semanticId} is not a semantic carrier`);
      }
    }
  }
}

// --- readback facts (parse saved .scene; unit-testable with synthetic JSON) -----

export interface CompanionFact {
  id: string;
  present: boolean;
  hasSemantic: boolean;
  type: string | null;
}

export interface SemanticCopyFact {
  semanticId: string;
  expected: string;
  observed: unknown;
  matches: boolean;
}

export interface SemanticEditFact {
  semanticId: string;
  property: SemanticStyleEdit['property'] | SemanticGeometryEdit['property'];
  expected: string | number;
  observed: unknown;
  matches: boolean;
}

export interface SceneSeedFacts {
  scene: string;
  companions: CompanionFact[];
  semanticCopy: SemanticCopyFact[];
  semanticStyle: SemanticEditFact[];
  semanticGeometry: SemanticEditFact[];
  semanticIdCount: number;
}

interface SceneObject {
  id?: string;
  type?: string;
  text?: unknown;
  components?: unknown;
  [key: string]: unknown;
}

function objectHasSemantic(object: SceneObject): boolean {
  const components = Array.isArray(object.components) ? object.components : [];
  if (components.includes('Semantic')) return true;
  return Object.keys(object).some((key) => key === 'Semantic' || key.startsWith('Semantic.'));
}

/**
 * Parse a saved scene's authority and report, for its plan, whether every
 * companion is present + non-semantic, whether every semantic copy landed, and
 * how many semantic carriers the scene still holds (drift check).
 */
export async function readSceneSeedFacts(project: string, plan: SceneVisualPlan): Promise<SceneSeedFacts> {
  const raw = await readFile(path.join(project, 'src', 'scenes', plan.scene), 'utf8');
  return sceneSeedFactsFromJSON(raw, plan);
}

/** Pure core of {@link readSceneSeedFacts} (parses an already-read scene string). */
export function sceneSeedFactsFromJSON(raw: string, plan: SceneVisualPlan): SceneSeedFacts {
  const scene = JSON.parse(raw) as { displayList?: SceneObject[] };
  const list = scene.displayList ?? [];
  const byId = new Map<string, SceneObject>();
  for (const object of list) {
    if (typeof object.id === 'string') byId.set(object.id, object);
  }
  const companions: CompanionFact[] = plan.companions.map((companion) => {
    const object = byId.get(companion.id);
    return {
      id: companion.id,
      present: object !== undefined,
      hasSemantic: object !== undefined && objectHasSemantic(object),
      type: (object?.type as string | undefined) ?? null,
    };
  });
  const semanticCopy: SemanticCopyFact[] = plan.semanticCopy.map((edit) => {
    const object = byId.get(edit.semanticId);
    const observed = object?.text;
    return { semanticId: edit.semanticId, expected: edit.value, observed, matches: observed === edit.value };
  });
  const observedProperty = (object: SceneObject | undefined, property: string): unknown => {
    const explicit = object?.[property];
    if (explicit !== undefined) return explicit;
    if (property === 'x' || property === 'y') return 0;
    if (property === 'originX' || property === 'originY') {
      return object?.type === 'Text' || object?.type === 'BitmapText' ? 0 : 0.5;
    }
    if (property === 'scaleX' || property === 'scaleY') return 1;
    if (property === 'color') return '#fff';
    if (property === 'fontFamily') return 'Arial';
    if (property === 'fontSize') return '16px';
    return undefined;
  };
  const semanticStyle: SemanticEditFact[] = plan.semanticStyle.map((edit) => {
    const object = byId.get(edit.semanticId);
    const observed = observedProperty(object, edit.property);
    return { semanticId: edit.semanticId, property: edit.property, expected: edit.value, observed, matches: observed === edit.value };
  });
  const semanticGeometry: SemanticEditFact[] = plan.semanticGeometry.map((edit) => {
    const object = byId.get(edit.semanticId);
    const observed = observedProperty(object, edit.property);
    return { semanticId: edit.semanticId, property: edit.property, expected: edit.value, observed, matches: observed === edit.value };
  });
  const semanticIdCount = list.filter((object) => objectHasSemantic(object)).length;
  return { scene: plan.scene, companions, semanticCopy, semanticStyle, semanticGeometry, semanticIdCount };
}

// --- typed evidence -------------------------------------------------------------

export interface SceneSeedCheckpoint {
  scene: string;
  createdIds: string[];
  updatedIds: string[];
  skippedIds: string[];
  changed: boolean;
  facts: SceneSeedFacts;
}

export interface VisualSeedEvidence {
  schema: typeof VISUAL_SEED_SCHEMA;
  result: 'ok' | 'blocked';
  code?: string;
  detail?: string;
  p0Hash: string;
  port: number;
  companionCount: number;
  semanticCopyCount: number;
  semanticStyleCount: number;
  semanticGeometryCount: number;
  editServerMode: ServerMode | null;
  editEndpointDownProven: boolean;
  authority: {
    fresh: string | null;
    afterEditor: string | null;
    final: string | null;
  };
  semanticIdsExpected: number;
  semanticIdsObserved: number | null;
  semanticIdsPreserved: boolean;
  checkpoints: SceneSeedCheckpoint[];
  provenance: ProvenanceEvidence | null;
}

export interface VisualSeedOptions {
  scratch: string;
  project: string;
  p0Hash: string;
  port?: number;
  serverBin?: string;
}

export interface VisualSeedResult {
  result: 'ok' | 'blocked';
  code?: string;
  scratch: string;
  project: string;
  evidencePath: string;
  evidence: VisualSeedEvidence;
}

class VisualSeedBlocked extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'VisualSeedBlocked';
  }
}

const EXPECTED_SEMANTIC_IDS = 48;
const DEFAULT_PORT = 19_640;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mint a fresh reset scratch outside the repository and run the visual-seed
 * operation against it. This is the runner the conductor calls; it NEVER touches
 * canonical files (the scratch is guarded fail-closed).
 */
export async function runVisualSeedSession(options: { port?: number; serverBin?: string } = {}): Promise<VisualSeedResult> {
  const fresh: ScratchResult = await resetToScratch();
  return runVisualSeed({
    scratch: fresh.scratch,
    project: fresh.project,
    p0Hash: fresh.p0Hash,
    port: options.port,
    serverBin: options.serverBin,
  });
}

/**
 * Apply the deterministic visual seed to an explicit reset scratch through the
 * real Editor, then delegate compile-twice + terminate/restart/reopen stability
 * to `captureProvenance`. Always returns a typed ok/blocked result and writes a
 * scrubbed, hash-only evidence file.
 */
export async function runVisualSeed(options: VisualSeedOptions): Promise<VisualSeedResult> {
  const port = options.port ?? DEFAULT_PORT;
  const runId = randomUUID().slice(0, 8);
  let evidencePath = path.join(os.tmpdir(), `u5-visual-seed-${runId}.json`);
  const evidence: VisualSeedEvidence = {
    schema: VISUAL_SEED_SCHEMA,
    result: 'blocked',
    p0Hash: options.p0Hash,
    port,
    companionCount: allCompanions().length,
    semanticCopyCount: VISUAL_SEED.reduce((n, plan) => n + plan.semanticCopy.length, 0),
    semanticStyleCount: VISUAL_SEED.reduce((n, plan) => n + plan.semanticStyle.length, 0),
    semanticGeometryCount: VISUAL_SEED.reduce((n, plan) => n + plan.semanticGeometry.length, 0),
    editServerMode: null,
    editEndpointDownProven: false,
    authority: { fresh: null, afterEditor: null, final: null },
    semanticIdsExpected: EXPECTED_SEMANTIC_IDS,
    semanticIdsObserved: null,
    semanticIdsPreserved: false,
    checkpoints: [],
    provenance: null,
  };

  let server: ChildProcess | null = null;
  let workbench: Workbench | null = null;
  let project = options.project;
  let scratch = options.scratch;
  let roots: string[] = [REPO_ROOT, os.homedir(), scratch, project];

  try {
    const layout = resolveScratch(scratch);
    scratch = layout.scratch;
    project = layout.project;
    roots = [REPO_ROOT, os.homedir(), scratch, project, layout.plugins];
    if (path.resolve(options.project) !== project) {
      throw new VisualSeedBlocked('scratch-project-mismatch', 'the project is not the resolved reset scratch project');
    }
    evidencePath = path.join(scratch, 'evidence', `visual-seed-${runId}.json`);
    evidence.authority.fresh = (await hashGraph(project, SCENE_AUTHORITY)).combined;

    const serverBin = resolveServerBin(options.serverBin);
    roots.push(serverBin);
    server = await startEditorServer({ projectDir: project, pluginsDir: layout.plugins, port, serverBin });
    evidence.editServerMode = await getServerMode(port);
    if (!evidence.editServerMode.desktop || !evidence.editServerMode.unlocked) {
      throw new VisualSeedBlocked('server-mode', 'the editor is not a desktop, unlocked session');
    }

    workbench = await openWorkbench(port);
    for (const plan of orderedPlans()) {
      const expectedIds = await semanticIdsForScene(project, plan.scene);
      const applied = await applyPlanThroughWorkbench(workbench.page, plan, expectedIds);
      const facts = await readSceneSeedFacts(project, plan);
      assertSceneFacts(plan, facts);
      evidence.checkpoints.push({
        scene: plan.scene,
        createdIds: applied.createdIds,
        updatedIds: applied.updatedIds,
        skippedIds: applied.skippedIds,
        changed: applied.changed,
        facts,
      });
    }
    await closeWorkbench(workbench);
    workbench = null;
    evidence.editEndpointDownProven = await stopEditorServer(server, port);
    server = null;
    if (!evidence.editEndpointDownProven) {
      throw new VisualSeedBlocked('endpoint-not-down', 'the edit-session loopback endpoint did not go down');
    }

    evidence.authority.afterEditor = (await hashGraph(project, SCENE_AUTHORITY)).combined;
    if (evidence.authority.afterEditor === evidence.authority.fresh
      && evidence.checkpoints.some((checkpoint) => checkpoint.changed)) {
      throw new VisualSeedBlocked('seed-noop', 'the Editor operations did not change scene authority');
    }
    const observed = evidence.checkpoints.reduce((n, cp) => n + cp.facts.semanticIdCount, 0);
    evidence.semanticIdsObserved = observed;
    evidence.semanticIdsPreserved = observed === EXPECTED_SEMANTIC_IDS;
    if (!evidence.semanticIdsPreserved) {
      throw new VisualSeedBlocked('semantic-id-drift', `expected ${EXPECTED_SEMANTIC_IDS} semantic ids, saw ${observed}`);
    }

    const provenance = await captureProvenance({
      scratch,
      output: path.join(scratch, 'evidence', `provenance-visual-seed-${runId}.json`),
      port,
      serverBin: options.serverBin,
    });
    evidence.provenance = provenance.evidence;
    if (provenance.result !== 'ok') {
      throw new VisualSeedBlocked(provenance.code ?? 'provenance-blocked', 'the compile/restart provenance protocol blocked');
    }

    evidence.authority.final = (await hashGraph(project, SCENE_AUTHORITY)).combined;
    if (evidence.authority.final !== evidence.authority.afterEditor) {
      throw new VisualSeedBlocked('seed-authority-drift', 'scene authority drifted across compile/save/restart/reopen');
    }
    if (!provenance.evidence.compile.deterministic
      || !provenance.evidence.authority.stableAcrossRestart
      || !provenance.evidence.generated.stableAcrossRestart
      || !provenance.evidence.restart.endpointDownProven) {
      throw new VisualSeedBlocked('provenance-incomplete', 'compile/restart evidence was not complete');
    }

    evidence.result = 'ok';
    await writeVisualSeedEvidence(evidencePath, evidence, roots);
    return { result: 'ok', scratch, project, evidencePath, evidence };
  } catch (error) {
    evidence.result = 'blocked';
    evidence.code = blockCode(error);
    evidence.detail = scrubText(errorMessage(error), roots);
    await writeVisualSeedEvidence(evidencePath, evidence, roots);
    return { result: 'blocked', code: evidence.code, scratch, project, evidencePath, evidence };
  } finally {
    await closeWorkbench(workbench);
    await closeConnectedCdpBrowser();
    if (server) {
      try {
        await stopEditorServer(server, port);
      } catch {
        // The typed blocked result already captured the primary failure.
      }
    }
  }
}

/** The plans to seed, in canonical scene-open order. */
function orderedPlans(): SceneVisualPlan[] {
  const plans: SceneVisualPlan[] = [];
  for (const scene of SEED_SCENE_ORDER) {
    const plan = planForScene(scene);
    if (plan) plans.push(plan);
  }
  return plans;
}

interface AppliedPlan {
  createdIds: string[];
  updatedIds: string[];
  skippedIds: string[];
  changed: boolean;
}

async function semanticIdsForScene(project: string, scene: string): Promise<string[]> {
  const raw = JSON.parse(await readFile(path.join(project, 'src', 'scenes', scene), 'utf8')) as {
    displayList?: SceneObject[];
  };
  const ids: string[] = [];
  const walk = (list: SceneObject[] | undefined): void => {
    for (const object of list ?? []) {
      if (objectHasSemantic(object) && typeof object.id === 'string') ids.push(object.id);
      if (Array.isArray(object.list)) walk(object.list as SceneObject[]);
    }
  };
  walk(raw.displayList);
  if (ids.length === 0) throw new VisualSeedBlocked('semantic-precondition-empty', `${scene} has no semantic carriers before opening`);
  return ids.sort();
}

/**
 * Open one scene, create its missing companions through a single
 * `SceneSnapshotOperation` (idempotent: already-seeded ids are skipped), force
 * every companion behind the semantic carriers by display-list order, apply the
 * semantic copy edits through `SimpleOperation`, then save + close the editor.
 */
async function applyPlanThroughWorkbench(
  page: Page,
  plan: SceneVisualPlan,
  expectedSemanticIds: readonly string[],
): Promise<AppliedPlan> {
  const sceneLiteral = JSON.stringify(plan.scene);
  const companionJson = JSON.stringify(plan.companions.map(companionObjData));
  const semanticJson = JSON.stringify(plan.semanticCopy);
  const styleJson = JSON.stringify(plan.semanticStyle);
  const geometryJson = JSON.stringify(plan.semanticGeometry);
  const expectedIdsJson = JSON.stringify(expectedSemanticIds);

  // Open the scene and wait until it is the active editor with its model loaded.
  await page.evaluate(
    `(async () => {
      const FileUtils = globalThis.colibri.ui.ide.FileUtils;
      const root = FileUtils.getRoot();
      const find = (file) => {
        if (file.getName() === ${sceneLiteral}) return file;
        for (const child of (file.getFiles?.() ?? [])) { const hit = find(child); if (hit) return hit; }
        return null;
      };
      const file = find(root);
      if (!file) throw new Error('scene not found: ' + ${sceneLiteral});
      const editor = await globalThis.colibri.Platform.getWorkbench().openEditor(file);
      if (!editor?.isGameReadyPromise) throw new Error('opened scene has no readiness promise');
      await editor.isGameReadyPromise();
    })()`,
  );
  await page.waitForFunction(
    `globalThis.colibri.Platform.getWorkbench().getActiveEditor()?.getInput?.()?.getName?.() === ${sceneLiteral}`,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    `Boolean(globalThis.colibri.Platform.getWorkbench().getEditors()
      .find((c) => c.getInput?.()?.getName?.() === ${sceneLiteral})?.getScene?.())`,
    undefined,
    { timeout: 30_000 },
  );

  const applied = (await page.evaluate(
    `(async () => {
      const scenePkg = globalThis.phasereditor2d?.scene;
      const objects = scenePkg?.ui?.sceneobjects;
      if (!scenePkg || !objects?.SimpleOperation) throw new Error('Editor scene API is unavailable');
      const wb = globalThis.colibri.Platform.getWorkbench();
      const editor = wb.getEditors().find((c) => c.getInput?.()?.getName?.() === ${sceneLiteral});
      if (!editor) throw new Error('opened scene editor disappeared: ' + ${sceneLiteral});
      const sceneObj = editor.getScene();
      const maker = editor.getSceneMaker();
      const finder = maker.getPackFinder();
      if (!editor.isGameReadyPromise) throw new Error('scene editor has no readiness promise');
      await editor.isGameReadyPromise();
      await finder.preload();

      const companions = ${companionJson};
      const semanticEdits = ${semanticJson};
      const styleEdits = ${styleJson};
      const geometryEdits = ${geometryJson};
      const expectedSemanticIds = ${expectedIdsJson};
      const missingBeforeMutation = expectedSemanticIds.filter((id) => !sceneObj.getByEditorId(id));
      if (missingBeforeMutation.length > 0) {
        throw new Error('semantic precondition failed before mutation: ' + missingBeforeMutation.join(', '));
      }
      const createdIds = [];
      const updatedIds = [];
      const skippedIds = [];
      const toCreate = [];
      const toUpdate = [];
      const serializedValue = (data, field) => {
        if (data[field] !== undefined) return data[field];
        if (field === 'x' || field === 'y') return 0;
        if (field === 'originX' || field === 'originY') {
          return data.type === 'Text' || data.type === 'BitmapText' ? 0 : 0.5;
        }
        if (field === 'scaleX' || field === 'scaleY') return 1;
        if (field === 'fillAlpha' || field === 'strokeAlpha' || field === 'lineWidth') return 1;
        if (field === 'rounded') return 0;
        if (field === 'isFilled' || field === 'isStroked') return false;
        if (field === 'visible') return true;
        if (field === 'fontFamily') return 'Arial';
        if (field === 'fontSize') return '16px';
        if (field === 'color' || field === 'fillColor' || field === 'strokeColor') return '#fff';
        return undefined;
      };
      const fieldsFor = (objData) => [
        'x', 'y', 'originX', 'originY',
        ...(objData.type === 'Image' ? ['texture', 'scaleX', 'scaleY', 'visible'] : []),
        ...(objData.type === 'Rectangle'
          ? ['width', 'height', 'isFilled', 'fillColor', 'fillAlpha', 'rounded',
            'isStroked', 'strokeColor', 'strokeAlpha', 'lineWidth']
          : []),
        ...(objData.type === 'Text' ? ['text', 'fontFamily', 'fontSize', 'color'] : []),
      ].filter((field) => objData[field] !== undefined);
      const valuesMatch = (expected, observed) => {
        if (typeof expected === 'number') return Math.abs(observed - expected) < 1e-9;
        if (expected && typeof expected === 'object') return JSON.stringify(observed) === JSON.stringify(expected);
        return observed === expected;
      };
      const matchesRecipe = (obj, objData) => {
        const current = {};
        obj.getEditorSupport().writeJSON(current);
        return fieldsFor(objData).every((field) => {
        const expected = serializedValue(objData, field);
        const observed = serializedValue(current, field);
        return typeof expected === 'number'
          ? Math.abs(observed - expected) < 1e-9
          : valuesMatch(expected, observed);
        });
      };
      for (const objData of companions) {
        const existing = sceneObj.getByEditorId(objData.id);
        if (!existing) toCreate.push(objData);
        else if (matchesRecipe(existing, objData)) skippedIds.push(objData.id);
        else toUpdate.push(objData);
      }

      // Phaser Editor's own scene-update-game-objects tool updates existing
      // objects by snapshotting, serialising their current JSON, merging the
      // requested recipe, preloading it, and reading it back through Editor
      // support. Reuse that proven path so rerunning a changed seed repairs
      // existing companions instead of silently skipping stale coordinates.
      if (toCreate.length > 0 || toUpdate.length > 0) {
        const op = new scenePkg.ui.editor.undo.SceneSnapshotOperation(editor, async () => {
          for (const objData of toUpdate) {
            const obj = sceneObj.getByEditorId(objData.id);
            if (!obj) throw new Error('existing companion disappeared: ' + objData.id);
            const support = obj.getEditorSupport();
            const current = {};
            support.writeJSON(current);
            const merged = { ...current, ...objData };
            await maker.updateSceneLoaderWithGameObjectDataList(finder, [merged]);
            support.readJSON(merged);
            updatedIds.push(objData.id);
          }
          for (const objData of toCreate) {
            const ext = scenePkg.ScenePlugin.getInstance().getGameObjectExtensionByObjectType(objData.type);
            if (!ext) throw new Error('no game-object extension for type ' + objData.type);
            await maker.updateSceneLoaderWithGameObjectDataList(finder, [objData]);
            const obj = maker.createObject(objData);
            if (!obj) throw new Error('createObject failed for ' + objData.id);
            createdIds.push(objData.id);
          }
          // Force every companion behind the semantic carriers, preserving recipe
          // order (labels stay above surfaces). sendToBack in reverse so the first
          // companion ends at display-list index 0.
          const list = sceneObj.sys.displayList;
          const companionObjs = companions
            .map((d) => sceneObj.getByEditorId(d.id))
            .filter((o) => Boolean(o));
          for (let i = companionObjs.length - 1; i >= 0; i--) {
            list.sendToBack(companionObjs[i]);
          }
        });
        await editor.getUndoManager().add(op);
      }

      for (const objData of companions) {
        const obj = sceneObj.getByEditorId(objData.id);
        if (!obj) throw new Error('companion missing after recipe update: ' + objData.id);
        const current = {};
        obj.getEditorSupport().writeJSON(current);
        for (const field of fieldsFor(objData)) {
          const expected = serializedValue(objData, field);
          const observed = serializedValue(current, field);
          const matches = valuesMatch(expected, observed);
          if (!matches) {
            throw new Error('companion recipe did not apply on ' + objData.id + '.' + field);
          }
        }
      }

      let semanticChanged = 0;
      for (const edit of semanticEdits) {
        const target = sceneObj.getByEditorId(edit.semanticId);
        if (!target) throw new Error('semantic target not found: ' + edit.semanticId);
        const prop = objects.TextContentComponent?.text;
        if (!prop || !target.getEditorSupport().hasProperty(prop)) {
          throw new Error('semantic target has no text property: ' + edit.semanticId);
        }
        if (prop.getValue(target) !== edit.value) {
          semanticChanged++;
          await editor.getUndoManager().add(new objects.SimpleOperation(editor, [target], prop, edit.value));
        }
        if (prop.getValue(target) !== edit.value) {
          throw new Error('semantic copy did not apply on ' + edit.semanticId);
        }
      }

      const propertyFor = (edit) => {
        if (edit.property === 'color') return objects.TextComponent?.color;
        if (edit.property === 'fontFamily') return objects.TextComponent?.fontFamily;
        if (edit.property === 'fontSize') return objects.TextComponent?.fontSize;
        if (edit.property === 'x') return objects.TransformComponent?.x;
        if (edit.property === 'y') return objects.TransformComponent?.y;
        if (edit.property === 'originX') return objects.OriginComponent?.originX;
        if (edit.property === 'originY') return objects.OriginComponent?.originY;
        if (edit.property === 'scaleX') return objects.TransformComponent?.scaleX;
        if (edit.property === 'scaleY') return objects.TransformComponent?.scaleY;
        return null;
      };
      for (const edit of [...styleEdits, ...geometryEdits]) {
        const target = sceneObj.getByEditorId(edit.semanticId);
        if (!target) throw new Error('semantic edit target not found: ' + edit.semanticId);
        const prop = propertyFor(edit);
        if (!prop || !target.getEditorSupport().hasProperty(prop)) {
          throw new Error('semantic target has no ' + edit.property + ' property: ' + edit.semanticId);
        }
        if (prop.getValue(target) !== edit.value) {
          semanticChanged++;
          await editor.getUndoManager().add(new objects.SimpleOperation(editor, [target], prop, edit.value));
        }
        if (prop.getValue(target) !== edit.value) {
          throw new Error('semantic ' + edit.property + ' did not apply on ' + edit.semanticId);
        }
      }

      // Re-assert the created companions are present and NON-semantic.
      for (const objData of companions) {
        const obj = sceneObj.getByEditorId(objData.id);
        if (!obj) throw new Error('companion missing after seed: ' + objData.id);
        const userComps = obj.getEditorSupport().getUserComponentsComponent?.();
        if (userComps?.hasLocalUserComponent?.('Semantic')) {
          throw new Error('companion carries Semantic: ' + objData.id);
        }
      }

      await editor.save();
      wb.getActiveWindow().getEditorArea().closeEditors([editor]);
      return {
        createdIds,
        updatedIds,
        skippedIds,
        changed: createdIds.length > 0 || updatedIds.length > 0 || semanticChanged > 0,
      };
    })()`,
  )) as AppliedPlan;
  await delay(750);
  return applied;
}

/** Assert every companion persisted non-semantic and every copy edit landed. */
function assertSceneFacts(plan: SceneVisualPlan, facts: SceneSeedFacts): void {
  for (const companion of facts.companions) {
    if (!companion.present) {
      throw new VisualSeedBlocked('companion-missing', `saved ${plan.scene} is missing companion ${companion.id}`);
    }
    if (companion.hasSemantic) {
      throw new VisualSeedBlocked('companion-semantic', `companion ${companion.id} carries a Semantic component`);
    }
  }
  const mismatch = facts.semanticCopy.find((fact) => !fact.matches);
  if (mismatch) {
    throw new VisualSeedBlocked('semantic-copy-mismatch', `saved ${plan.scene} lacks ${mismatch.semanticId} copy`);
  }
  const editMismatch = [...facts.semanticStyle, ...facts.semanticGeometry].find((fact) => !fact.matches);
  if (editMismatch) {
    throw new VisualSeedBlocked(
      'semantic-edit-mismatch',
      `saved ${plan.scene} lacks ${editMismatch.semanticId}.${editMismatch.property}`,
    );
  }
}

async function writeVisualSeedEvidence(
  output: string,
  evidence: VisualSeedEvidence,
  sensitiveRoots: readonly string[],
): Promise<void> {
  assertNoLeaks(evidence, sensitiveRoots);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

function blockCode(error: unknown): string {
  if (error instanceof VisualSeedBlocked
    || error instanceof ServerBlocked
    || error instanceof WorkbenchBlocked
    || error instanceof PathBlocked) {
    return error.code;
  }
  return 'visual-seed-session-error';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
