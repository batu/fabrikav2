import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Hitbox, DogState, LevelSection, Orientation } from '../types';
import { bgFullUrl, dogVariantUrl, getGeometryConfig, type GeometryConfigResponse } from '../api/editorApi';
import { hasActiveVariant } from '../lib/dogs';
import { shortLabel } from '../lib/dogIdentity';

/**
 * The exact state slice LevelCanvas reads. Consumers can pass query-backed
 * session data or local modal state without recreating the old app reducer.
 */
export interface LevelCanvasState {
  sessionId: string | null;
  bgWidth: number;
  bgHeight: number;
  selectedBgIndex: number | null;
  orientation: Orientation;
  sections: LevelSection[];
  hitboxes: Hitbox[];
  dogs: DogState[];
  selectedDogIndex: number | null;
  showOverlay: boolean;
  radius: number;
  inpaintPadding: number;
}

/**
 * A canvas interaction, normalized so a consumer can target the new
 * stable-id + TanStack-Query path (DogsCanvas) OR the reducer (the wizard
 * steps). `dogId` is the stable id carried BY VALUE — resolved once at the
 * gesture and never re-derived from a later array position (spec -004 §6, §8).
 * `index` is the legacy fallback join key for id-less (un-backfilled) hitboxes.
 */
export type CanvasMutation =
  | { type: 'select'; index: number; dogId: string | null }
  | { type: 'move'; index: number; dogId: string | null; x: number; y: number }
  | { type: 'add'; hitbox: { x: number; y: number; r: number } }
  | { type: 'remove'; index: number; dogId: string | null };

export type LevelCanvasAction =
  | { type: 'SELECT_DOG'; index: number | null }
  | { type: 'MOVE_HITBOX'; index: number; x: number; y: number }
  | { type: 'ADD_HITBOX'; hitbox: Hitbox }
  | { type: 'REMOVE_HITBOX'; index: number };

interface Props {
  state: LevelCanvasState;
  dispatch?: React.Dispatch<LevelCanvasAction>;
  readOnly?: boolean;
  allowAddRemove?: boolean;
  /** If set, use this image URL as the background instead of the session bg */
  backgroundOverride?: string;
  /** If true, don't render dog variant images on the overlay */
  hideVariants?: boolean;
  /** Draw the per-hitbox identity label. Default true (the wizard steps show it);
   * DogsCanvas sets false — the raw id is a debug detail, not a user feature, and
   * returns later as a toggle in the overlay-chooser panel (spec -004 §1.5). */
  showLabels?: boolean;
  /** When provided, gestures emit normalized CanvasMutations here INSTEAD of
   * dispatching local actions. */
  onMutate?: (mutation: CanvasMutation) => void;
}

interface DragState {
  active: boolean;
  hitboxIndex: number;
  /** Stable id of the dragged dog, resolved at mousedown, carried by value. */
  dogId: string | null;
  offsetX: number;
  offsetY: number;
}

const HITBOX_COLOR = 'rgba(255, 0, 255, 0.6)';
const HITBOX_COLOR_SELECTED = 'rgba(0, 255, 255, 0.8)';
const HITBOX_FILL = 'rgba(255, 0, 255, 0.1)';
const HITBOX_FILL_SELECTED = 'rgba(0, 255, 255, 0.15)';
const HITBOX_COLOR_OVERLAP = 'rgba(255, 60, 60, 0.95)';
const HITBOX_FILL_OVERLAP = 'rgba(255, 60, 60, 0.15)';
const HITBOX_COLOR_BLOCKED = 'rgba(255, 34, 34, 1)';
const HITBOX_FILL_BLOCKED = 'rgba(255, 34, 34, 0.28)';
const HITBOX_COLOR_DANGER = 'rgba(255, 170, 0, 1)';
const HITBOX_FILL_DANGER = 'rgba(255, 170, 0, 0.22)';
const GENERATING_COLOR = 'rgba(255, 200, 0, 0.6)';

// Default padding multiplier the backend applies to _crop_box() when inpainting a
// single hitbox. The crop
// is a square of side 2*r*PADDING, centred on the hitbox. Drawn as a dashed
// rectangle so authors can see what actually gets shipped to Gemini and
// whether two padded regions collide.
const DEFAULT_INPAINT_PADDING = 2.75;
const PADDED_BOX_SHADOW = 'rgba(0, 0, 0, 0.82)';
const PADDED_BOX_COLOR = 'rgba(180, 255, 255, 0.95)';

// Dead-zone strip colors (consistent across portrait + landscape).
const DZ_HUD_BANNER = 'rgba(255, 20, 20, 0.34)';
const DZ_CROP = 'rgba(255, 155, 0, 0.28)';
const DZ_HINT = 'rgba(255, 210, 0, 0.30)';
const DZ_HUD_STROKE = 'rgba(255, 45, 45, 0.95)';
const DZ_CROP_STROKE = 'rgba(255, 175, 0, 0.95)';
const DZ_HATCH_RED = 'rgba(255, 255, 255, 0.28)';
const DZ_HATCH_ORANGE = 'rgba(0, 0, 0, 0.25)';
// Section divider stroke for landscape mode.
const SECTION_DIVIDER_COLOR = 'rgba(0,255,255,0.5)';

interface DeadZoneRect {
  label: string;
  severity: 'blocked' | 'danger';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

/** Forbidden / dead-zone rectangles in IMAGE pixel coordinates. The RAF loop
 * multiplies by `scale` to get canvas pixels.
 *
 * Portrait: HUD top, ad-banner bottom, left/right crop strips, hint badge —
 * scaled from the 768×1376 reference. Dogs placed here render behind UI or
 * get cropped on some devices.
 *
 * Landscape: HUD band (13.9% of height) and ad-banner band (7.1%) span full
 * width — runtime cover-scale puts the level's height equal to the viewport,
 * so the strips sit at the top/bottom of the level image itself. Plus 60px
 * outer-edge safe strips and boundary buffers on each side of every shared
 * section edge — these match the section_forbidden_zones helper in
 * dog_pipeline.sections so the builder canvas and the CLI generator agree on
 * placement geometry. */
function zoneStyle(label: string): Pick<DeadZoneRect, 'severity' | 'color'> {
  if (label === 'HUD' || label === 'AD') return { severity: 'blocked', color: DZ_HUD_BANNER };
  if (label === 'HINT') return { severity: 'danger', color: DZ_HINT };
  return { severity: 'danger', color: DZ_CROP };
}

// Fallback literals mirror /api/config/geometry. The normal app path consumes
// that server payload so Dogs, Gallery, Lineup validation, and the canvas overlay
// share the same geometry source.
export function getDeadZones(
  orientation: Orientation,
  bgWidth: number,
  bgHeight: number,
  geometry?: GeometryConfigResponse | null,
): DeadZoneRect[] {
  if (bgWidth <= 0 || bgHeight <= 0) return [];

  if (geometry) {
    if (orientation === 'landscape') {
      const hud = Math.floor(bgHeight * geometry.hudFraction);
      const banner = Math.floor(bgHeight * geometry.bannerFraction);
      const edge = geometry.landscapeEdgeSafeArea;
      const buffer = geometry.sectionBoundaryBuffer;
      const sectionW = Math.floor(bgWidth / geometry.nSections);
      return [
        { label: 'HUD', severity: 'blocked', x: 0, y: 0, w: bgWidth, h: hud, color: DZ_HUD_BANNER },
        { label: 'AD', severity: 'blocked', x: 0, y: bgHeight - banner, w: bgWidth, h: banner, color: DZ_HUD_BANNER },
        { label: 'SAFE L', severity: 'danger', x: 0, y: 0, w: edge, h: bgHeight, color: DZ_CROP },
        { label: 'SAFE R', severity: 'danger', x: bgWidth - edge, y: 0, w: edge, h: bgHeight, color: DZ_CROP },
        ...Array.from({ length: Math.max(0, geometry.nSections - 1) }).flatMap((_, index) => {
          const edgeX = sectionW * (index + 1);
          const label = index + 1;
          return [
            { label: `BUF ${label}L`, severity: 'danger' as const, x: edgeX - buffer, y: 0, w: buffer, h: bgHeight, color: DZ_CROP },
            { label: `BUF ${label}R`, severity: 'danger' as const, x: edgeX, y: 0, w: buffer, h: bgHeight, color: DZ_CROP },
          ];
        }),
      ];
    }

    const sx = bgWidth / geometry.portraitReference.width;
    const sy = bgHeight / geometry.portraitReference.height;
    return geometry.portraitReference.deadzones.map((zone) => ({
      label: zone.label,
      ...zoneStyle(zone.label),
      x: zone.x * sx,
      y: zone.y * sy,
      w: zone.w * sx,
      h: zone.h * sy,
    }));
  }

  if (orientation === 'landscape') {
    const hud = Math.floor(bgHeight * 0.139);
    const banner = Math.floor(bgHeight * 0.071);
    const buffer = 60;
    const sectionW = Math.floor(bgWidth / 3);
    return [
      { label: 'HUD',     severity: 'blocked', x: 0, y: 0,                  w: bgWidth, h: hud,    color: DZ_HUD_BANNER },
      { label: 'AD',      severity: 'blocked', x: 0, y: bgHeight - banner,  w: bgWidth, h: banner, color: DZ_HUD_BANNER },
      { label: 'SAFE L',  severity: 'danger',  x: 0,                       y: 0, w: buffer, h: bgHeight, color: DZ_CROP },
      { label: 'SAFE R',  severity: 'danger',  x: bgWidth - buffer,        y: 0, w: buffer, h: bgHeight, color: DZ_CROP },
      // Boundary buffers on each side of the two shared section edges.
      { label: 'BUF 1L',  severity: 'danger',  x: sectionW - buffer,       y: 0, w: buffer, h: bgHeight, color: DZ_CROP },
      { label: 'BUF 1R',  severity: 'danger',  x: sectionW,                y: 0, w: buffer, h: bgHeight, color: DZ_CROP },
      { label: 'BUF 2L',  severity: 'danger',  x: 2 * sectionW - buffer,   y: 0, w: buffer, h: bgHeight, color: DZ_CROP },
      { label: 'BUF 2R',  severity: 'danger',  x: 2 * sectionW,            y: 0, w: buffer, h: bgHeight, color: DZ_CROP },
    ];
  }

  // Portrait: scale the legacy 768×1376 reference rects to the actual bg.
  const sx = bgWidth / 768;
  const sy = bgHeight / 1376;
  return [
    { label: 'HUD',    severity: 'blocked', x: 0,           y: 0,             w: 768 * sx, h: 191 * sy,  color: DZ_HUD_BANNER },
    { label: 'AD',     severity: 'blocked', x: 0,           y: 1278 * sy,     w: 768 * sx, h: 98 * sy,   color: DZ_HUD_BANNER },
    { label: 'CROP L', severity: 'danger',  x: 0,           y: 0,             w: 90 * sx,  h: 1376 * sy, color: DZ_CROP },
    { label: 'CROP R', severity: 'danger',  x: 678 * sx,    y: 0,             w: 90 * sx,  h: 1376 * sy, color: DZ_CROP },
    { label: 'HINT',   severity: 'danger',  x: 551 * sx,    y: 1151 * sy,     w: 137 * sx, h: 100 * sy,  color: DZ_HINT },
  ];
}

function circleIntersectsRect(hb: Hitbox, zone: DeadZoneRect): boolean {
  const nearestX = Math.max(zone.x, Math.min(hb.x, zone.x + zone.w));
  const nearestY = Math.max(zone.y, Math.min(hb.y, zone.y + zone.h));
  const dx = hb.x - nearestX;
  const dy = hb.y - nearestY;
  return dx * dx + dy * dy <= hb.r * hb.r;
}

function hitboxZoneSeverity(hb: Hitbox, zones: DeadZoneRect[]): 'blocked' | 'danger' | null {
  let danger = false;
  for (const zone of zones) {
    if (!circleIntersectsRect(hb, zone)) continue;
    if (zone.severity === 'blocked') return 'blocked';
    danger = true;
  }
  return danger ? 'danger' : null;
}

function drawDangerZone(ctx: CanvasRenderingContext2D, zone: DeadZoneRect, scale: number): void {
  const x = zone.x * scale;
  const y = zone.y * scale;
  const w = zone.w * scale;
  const h = zone.h * scale;
  const blocked = zone.severity === 'blocked';

  ctx.save();
  ctx.fillStyle = zone.color;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = blocked ? DZ_HUD_STROKE : DZ_CROP_STROKE;
  ctx.lineWidth = blocked ? 3 : 2;
  ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));

  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = blocked ? DZ_HATCH_RED : DZ_HATCH_ORANGE;
  ctx.lineWidth = blocked ? 2 : 1.5;
  const spacing = blocked ? 16 : 20;
  for (let offset = -h; offset < w + h; offset += spacing) {
    ctx.beginPath();
    ctx.moveTo(x + offset, y + h);
    ctx.lineTo(x + offset + h, y);
    ctx.stroke();
  }

  const label = blocked ? `${zone.label} BLOCKED` : `${zone.label} DANGER`;
  ctx.font = `bold ${Math.max(11, Math.min(18, 13 * scale))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = blocked ? 'rgba(80, 0, 0, 0.82)' : 'rgba(75, 45, 0, 0.82)';
  const labelW = Math.min(w - 8, ctx.measureText(label).width + 16);
  const labelH = Math.max(18, 22 * scale);
  if (labelW > 24 && labelH < h + 4) {
    const labelX = x + w / 2;
    const labelY = y + Math.min(h / 2, labelH / 2 + 8);
    ctx.fillRect(labelX - labelW / 2, labelY - labelH / 2, labelW, labelH);
    ctx.fillStyle = '#fff7d8';
    ctx.fillText(label, labelX, labelY);
  }
  ctx.restore();
}

/** Map a hitbox x-coord to a section index for landscape placement. Mirrors
 * SectionController.ts:62-66 (left-inclusive, right-exclusive on xEnd) so
 * builder counter chips and game runtime agree on which section owns a dog at
 * a boundary. Returns -1 if no section contains x (out-of-range) or if
 * sections is empty (portrait or pre-bg-select). */
function sectionIndexForX(sections: LevelSection[], x: number): number {
  for (let i = 0; i < sections.length; i++) {
    if (x >= sections[i].xStart && x < sections[i].xEnd) return i;
  }
  // x === sections[-1].xEnd is on the boundary — clamp to last section.
  if (sections.length > 0 && x >= sections[sections.length - 1].xEnd) {
    return sections.length - 1;
  }
  return -1;
}

// Throttle generating pulse to ~12fps
const GENERATING_FRAME_INTERVAL = 80;

export default function LevelCanvas({ state, dispatch, readOnly = false, allowAddRemove = true, backgroundOverride, hideVariants = false, showLabels = true, onMutate }: Props) {
  const geometryQuery = useQuery({
    queryKey: ['geometry-config'],
    queryFn: getGeometryConfig,
    staleTime: Infinity,
    retry: false,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const dogImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const dragRef = useRef<DragState>({ active: false, hitboxIndex: -1, dogId: null, offsetX: 0, offsetY: 0 });
  const dirtyRef = useRef(true);
  const animFrameRef = useRef(0);
  const scaleRef = useRef(1);
  const lastDrawTimeRef = useRef(0);
  // Local copy of hitboxes for drag — avoids React re-renders mid-drag
  const hitboxesRef = useRef<Hitbox[]>(state.hitboxes);
  // Refs for RAF loop state to avoid re-creating the effect
  const dogsRef = useRef<DogState[]>(state.dogs);
  const selectedDogIndexRef = useRef<number | null>(state.selectedDogIndex);
  const showOverlayRef = useRef(state.showOverlay);
  const showLabelsRef = useRef(showLabels);
  const sessionIdRef = useRef(state.sessionId);
  // Orientation + sections feed the landscape overlay (dividers + counters).
  // Read inside the RAF loop so they update live without re-creating the effect.
  const orientationRef = useRef(state.orientation);
  const sectionsRef = useRef(state.sections);
  const inpaintPaddingRef = useRef(state.inpaintPadding ?? DEFAULT_INPAINT_PADDING);
  const canvasSizeRef = useRef({ w: 0, h: 0 });

  // Memoize dead zones per (orientation, bgWidth, bgHeight) so the RAF loop
  // doesn't reallocate the array every frame.
  const deadZones = useMemo(
    () => getDeadZones(state.orientation, state.bgWidth, state.bgHeight, geometryQuery.data),
    [geometryQuery.data, state.orientation, state.bgWidth, state.bgHeight],
  );
  const deadZonesRef = useRef(deadZones);
  useEffect(() => {
    deadZonesRef.current = deadZones;
    dirtyRef.current = true;
  }, [deadZones]);

  // Keep refs in sync when state changes (but hitboxes not during drag)
  useEffect(() => {
    if (!dragRef.current.active) {
      hitboxesRef.current = state.hitboxes;
    }
    dogsRef.current = state.dogs;
    selectedDogIndexRef.current = state.selectedDogIndex;
    showOverlayRef.current = state.showOverlay;
    showLabelsRef.current = showLabels;
    sessionIdRef.current = state.sessionId;
    orientationRef.current = state.orientation;
    sectionsRef.current = state.sections;
    inpaintPaddingRef.current = state.inpaintPadding ?? DEFAULT_INPAINT_PADDING;
    dirtyRef.current = true;
  }, [state.hitboxes, state.dogs, state.selectedDogIndex, state.showOverlay, showLabels, state.sessionId, state.orientation, state.sections, state.inpaintPadding]);

  // Load background image (or override image like color.png)
  useEffect(() => {
    const url = backgroundOverride
      ?? (state.sessionId && state.selectedBgIndex !== null
        ? bgFullUrl(state.sessionId, state.selectedBgIndex)
        : null);
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      bgImageRef.current = img;
      drawBg();
      dirtyRef.current = true;
    };
    img.src = url;
  }, [state.sessionId, state.selectedBgIndex, backgroundOverride]);

  // Load dog variant images
  useEffect(() => {
    if (hideVariants) return;
    if (!state.sessionId) return;
    for (const dog of state.dogs) {
      if (dog.variants.length === 0) continue;
      if (!hasActiveVariant(dog)) continue;
      const variantPath = dog.variants[dog.activeVariant];
      if (!variantPath) continue;
      const url = dogVariantUrl(state.sessionId, variantPath);
      if (dogImagesRef.current.has(url)) continue;
      const img = new Image();
      img.onload = () => {
        dogImagesRef.current.set(url, img);
        dirtyRef.current = true;
      };
      img.src = url;
    }
  }, [hideVariants, state.sessionId, state.dogs]);

  const getScale = useCallback((): number => {
    const container = containerRef.current;
    if (!container || !state.bgWidth || !state.bgHeight) return 1;
    const rect = container.getBoundingClientRect();
    const scaleX = rect.width / state.bgWidth;
    return scaleX;
  }, [state.bgWidth, state.bgHeight]);

  const drawBg = useCallback(() => {
    const canvas = bgCanvasRef.current;
    const img = bgImageRef.current;
    if (!canvas || !img) return;

    const scale = getScale();
    scaleRef.current = scale;
    const w = Math.floor(state.bgWidth * scale);
    const h = Math.floor(state.bgHeight * scale);

    // Only reassign canvas dimensions when changed (avoids clearing)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, w, h);
  }, [state.bgWidth, state.bgHeight, getScale]);

  // Redraw bg when dimensions become available or change
  useEffect(() => {
    if (bgImageRef.current && state.bgWidth > 0 && state.bgHeight > 0) {
      drawBg();
      dirtyRef.current = true;
    }
  }, [state.bgWidth, state.bgHeight, drawBg]);

  // Resize observer — catches initial layout and window resizes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      drawBg();
      dirtyRef.current = true;
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [drawBg]);

  // Animation loop for overlay — uses refs for state to keep stable deps
  useEffect(() => {
    const loop = () => {
      animFrameRef.current = requestAnimationFrame(loop);

      const dogs = dogsRef.current;
      const hasGenerating = dogs.some((d) => d.status === 'generating');
      const now = performance.now();

      // Throttle generating pulse frames to ~12fps
      if (hasGenerating && !dirtyRef.current) {
        if (now - lastDrawTimeRef.current < GENERATING_FRAME_INTERVAL) return;
      }

      if (!dirtyRef.current && !hasGenerating) return;
      dirtyRef.current = false;
      lastDrawTimeRef.current = now;

      const canvas = overlayCanvasRef.current;
      if (!canvas) return;

      const scale = getScale();
      scaleRef.current = scale;
      const w = Math.floor(state.bgWidth * scale);
      const h = Math.floor(state.bgHeight * scale);

      // Only reassign canvas dimensions when changed
      if (canvasSizeRef.current.w !== w || canvasSizeRef.current.h !== h) {
        canvas.width = w;
        canvas.height = h;
        canvasSizeRef.current = { w, h };
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      const showOverlay = showOverlayRef.current;
      if (showOverlay) {
        // Draw dead zones (already in image-pixel coords; multiply by scale for canvas)
        for (const zone of deadZonesRef.current) {
          drawDangerZone(ctx, zone, scale);
        }
      }

      // Landscape: section dividers (vertical lines at sections[1].xStart and
      // sections[2].xStart). Reads from server-authoritative sections array, NOT
      // recomputed from bgWidth/3 — guarantees builder canvas and game runtime
      // (SectionController) agree on which side of a boundary owns a hitbox.
      const orientation = orientationRef.current;
      const sections = sectionsRef.current;
      if (orientation === 'landscape' && sections.length >= 2) {
        ctx.strokeStyle = SECTION_DIVIDER_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        for (let i = 1; i < sections.length; i++) {
          const x = sections[i].xStart * scale;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      const hitboxes = hitboxesRef.current;
      const selectedDogIndex = selectedDogIndexRef.current;
      const currentSessionId = sessionIdRef.current;

      for (let i = 0; i < hitboxes.length; i++) {
        const hb = hitboxes[i];
        const dog = dogs[i];
        const isSelected = selectedDogIndex === i;
        const isGenerating = dog?.status === 'generating';

        const cx = hb.x * scale;
        const cy = hb.y * scale;
        const cr = hb.r * scale;

        // Draw dog variant image if available and not hidden
        if (!hideVariants && dog && dog.status === 'done' && dog.variants.length > 0 && currentSessionId) {
          const variantPath = hasActiveVariant(dog) ? dog.variants[dog.activeVariant] : undefined;
          if (variantPath) {
            const url = dogVariantUrl(currentSessionId, variantPath);
            const img = dogImagesRef.current.get(url);
            if (img) {
              const padding = inpaintPaddingRef.current;
              const cropHalf = hb.r * padding;
              const drawW = cropHalf * 2 * scale;
              const drawH = cropHalf * 2 * scale;
              const drawX = (hb.x - cropHalf) * scale;
              const drawY = (hb.y - cropHalf) * scale;
              ctx.drawImage(img, drawX, drawY, drawW, drawH);
            }
          }
        }

        // Draw hitbox circles (overlay)
        if (showOverlay) {
          const zoneSeverity = hitboxZoneSeverity(hb, deadZonesRef.current);

          // Padded inpaint-crop square (what the backend actually sends to
          // Gemini — radius * INPAINT_PADDING on each side). This is drawn in
          // neutral grey only; red/orange danger states below are based solely
          // on the actual hitbox circle radius.
          const inpaintPadding = inpaintPaddingRef.current;
          const padHalf = hb.r * inpaintPadding * scale;
          ctx.save();
          ctx.setLineDash([6, 4]);
          ctx.lineWidth = 4;
          ctx.strokeStyle = PADDED_BOX_SHADOW;
          ctx.strokeRect(cx - padHalf, cy - padHalf, padHalf * 2, padHalf * 2);
          ctx.lineWidth = 2;
          ctx.strokeStyle = PADDED_BOX_COLOR;
          ctx.strokeRect(cx - padHalf, cy - padHalf, padHalf * 2, padHalf * 2);
          ctx.restore();

          ctx.beginPath();
          ctx.arc(cx, cy, cr, 0, Math.PI * 2);

          if (isGenerating) {
            const alpha = 0.3 + 0.4 * Math.sin(now / 300);
            ctx.strokeStyle = GENERATING_COLOR;
            ctx.fillStyle = `rgba(255, 200, 0, ${alpha * 0.2})`;
            ctx.lineWidth = 2;
          } else if (zoneSeverity === 'blocked') {
            ctx.strokeStyle = HITBOX_COLOR_BLOCKED;
            ctx.fillStyle = HITBOX_FILL_BLOCKED;
            ctx.lineWidth = isSelected ? 4 : 3;
          } else if (zoneSeverity === 'danger') {
            ctx.strokeStyle = HITBOX_COLOR_DANGER;
            ctx.fillStyle = HITBOX_FILL_DANGER;
            ctx.lineWidth = isSelected ? 3.5 : 2.75;
          } else if (isSelected) {
            ctx.strokeStyle = HITBOX_COLOR_SELECTED;
            ctx.fillStyle = HITBOX_FILL_SELECTED;
            ctx.lineWidth = 2.5;
          } else {
            ctx.strokeStyle = HITBOX_COLOR;
            ctx.fillStyle = HITBOX_FILL;
            ctx.lineWidth = 1.5;
          }

          ctx.fill();
          ctx.stroke();

          // Stable per-dog label (spec -004 §6.7): last-4-hex of the stable id,
          // NOT the array position — a delete leaves every survivor's label
          // unchanged, so the operator never sees "dog 8 become dog 7". Legacy
          // id-less hitboxes fall back to the index (shown with the legacy
          // banner in DogsCanvas).
          if (showLabelsRef.current) {
            ctx.fillStyle = zoneSeverity === 'blocked'
              ? '#ffffff'
              : zoneSeverity === 'danger'
                ? '#fff2b0'
                : isSelected ? '#00ffff' : '#ff00ff';
            ctx.font = `bold ${Math.max(10, cr * 0.42)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(shortLabel(hb.id, i), cx, cy);
          }

          if (zoneSeverity) {
            ctx.font = `bold ${Math.max(10, cr * 0.36)}px sans-serif`;
            ctx.fillStyle = zoneSeverity === 'blocked' ? '#ff3333' : '#ffb000';
            ctx.fillText('!', cx, cy - cr - 8);
          }
        }
      }

      // Landscape: per-section counter chips. Reads from `hitboxes` (the local
      // refs.current alias above) — NOT React state — so counts update live
      // during drag (the existing dragRef-skip-React-sync at the top means
      // state.hitboxes is stale until mouseup; the canvas-drawn chips read the
      // ground-truth ref). Drawn last so chips are on top of dividers.
      if (orientation === 'landscape' && sections.length === 3) {
        const counts = [0, 0, 0];
        for (const hb of hitboxes) {
          const idx = sectionIndexForX(sections, hb.x);
          if (idx >= 0 && idx < 3) counts[idx]++;
        }
        const chipPad = 8;
        const chipH = 28;
        const chipFont = 14;
        ctx.font = `bold ${chipFont}px sans-serif`;
        ctx.textBaseline = 'middle';
        for (let i = 0; i < 3; i++) {
          const sec = sections[i];
          const midX = ((sec.xStart + sec.xEnd) / 2) * scale;
          const text = String(counts[i]);
          const metrics = ctx.measureText(text);
          const chipW = Math.max(chipH, metrics.width + chipPad * 2);
          const chipX = midX - chipW / 2;
          const chipY = chipPad;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
          ctx.fillRect(chipX, chipY, chipW, chipH);
          ctx.fillStyle = '#00ffff';
          ctx.textAlign = 'center';
          ctx.fillText(text, midX, chipY + chipH / 2);
        }
      }
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [getScale, state.bgWidth, state.bgHeight]);

  // Hit test: find the smallest-radius hitbox under (x, y) in image coords
  const hitTest = useCallback(
    (imgX: number, imgY: number): number => {
      let bestIdx = -1;
      let bestR = Infinity;
      const hitboxes = hitboxesRef.current;

      for (let i = 0; i < hitboxes.length; i++) {
        const hb = hitboxes[i];
        const dx = imgX - hb.x;
        const dy = imgY - hb.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= hb.r && hb.r < bestR) {
          bestR = hb.r;
          bestIdx = i;
        }
      }
      return bestIdx;
    },
    [],
  );

  const canvasToImage = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scale = scaleRef.current || 1;
      return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale,
      };
    },
    [],
  );

  const clickIntentRef = useRef<{ x: number; y: number } | null>(null);

  // Route a gesture to the onMutate seam (DogsCanvas: query + stable-id save) or
  // fall back to the reducer (wizard steps). One place so every gesture honors
  // the seam identically.
  const emit = useCallback(
    (m: CanvasMutation): void => {
      if (onMutate) {
        onMutate(m);
        return;
      }
      if (!dispatch) return;
      switch (m.type) {
        case 'select': dispatch({ type: 'SELECT_DOG', index: m.index }); break;
        case 'move': dispatch({ type: 'MOVE_HITBOX', index: m.index, x: m.x, y: m.y }); break;
        case 'add': dispatch({ type: 'ADD_HITBOX', hitbox: m.hitbox }); break;
        case 'remove': dispatch({ type: 'REMOVE_HITBOX', index: m.index }); break;
      }
    },
    [onMutate, dispatch],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
      const { x, y } = canvasToImage(e.clientX, e.clientY);
      const idx = hitTest(x, y);

      // Track click position to distinguish click from drag
      clickIntentRef.current = { x: e.clientX, y: e.clientY };

      if (idx >= 0) {
        const hb = hitboxesRef.current[idx];
        dragRef.current = {
          active: true,
          hitboxIndex: idx,
          dogId: hb.id ?? null, // resolve once, carry by value
          offsetX: x - hb.x,
          offsetY: y - hb.y,
        };
        emit({ type: 'select', index: idx, dogId: hb.id ?? null });
      }
    },
    [readOnly, canvasToImage, hitTest, emit],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragRef.current.active) return;

      const { x, y } = canvasToImage(e.clientX, e.clientY);
      const idx = dragRef.current.hitboxIndex;
      const hb = hitboxesRef.current[idx];
      if (!hb) return;

      const newX = Math.max(hb.r, Math.min(state.bgWidth - hb.r, x - dragRef.current.offsetX));
      const newY = Math.max(hb.r, Math.min(state.bgHeight - hb.r, y - dragRef.current.offsetY));

      hitboxesRef.current = hitboxesRef.current.map((h, i) =>
        i === idx ? { ...h, x: Math.round(newX), y: Math.round(newY) } : h,
      );
      dirtyRef.current = true;
    },
    [canvasToImage, state.bgWidth, state.bgHeight],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
    // If we were dragging, commit the move
    if (dragRef.current.active) {
      const idx = dragRef.current.hitboxIndex;
      const dogId = dragRef.current.dogId; // resolved at mousedown, carried by value
      dragRef.current = { active: false, hitboxIndex: -1, dogId: null, offsetX: 0, offsetY: 0 };
      const hb = hitboxesRef.current[idx];
      if (hb) {
        emit({ type: 'move', index: idx, dogId, x: hb.x, y: hb.y });
      }
      clickIntentRef.current = null;
      return;
    }

    // Single click on empty area → place a new hitbox
    if (!readOnly && clickIntentRef.current) {
      const dx = e.clientX - clickIntentRef.current.x;
      const dy = e.clientY - clickIntentRef.current.y;
      // Only count as a click if mouse didn't move much (not a drag)
      if (dx * dx + dy * dy < 25) {
        const { x, y } = canvasToImage(e.clientX, e.clientY);
        const idx = hitTest(x, y);
        if (idx < 0 && allowAddRemove) {
          // Empty area — place new hitbox
          emit({ type: 'add', hitbox: { x: Math.round(x), y: Math.round(y), r: state.radius } });
        } else {
          // Clicked existing hitbox without dragging — select it
          emit({ type: 'select', index: idx, dogId: hitboxesRef.current[idx]?.id ?? null });
        }
      }
    }
    clickIntentRef.current = null;
  },
    [readOnly, allowAddRemove, canvasToImage, hitTest, state.radius, emit],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
      if (!allowAddRemove) return;
      const { x, y } = canvasToImage(e.clientX, e.clientY);
      const idx = hitTest(x, y);

      if (idx >= 0) {
        emit({ type: 'remove', index: idx, dogId: hitboxesRef.current[idx]?.id ?? null });
      } else {
        emit({ type: 'add', hitbox: { x: Math.round(x), y: Math.round(y), r: state.radius } });
      }
    },
    [readOnly, allowAddRemove, canvasToImage, hitTest, state.radius, emit],
  );

  return (
    <div className="level-canvas-container" ref={containerRef}>
      <canvas ref={bgCanvasRef} className="level-canvas bg-canvas" />
      <canvas
        ref={overlayCanvasRef}
        className="level-canvas overlay-canvas"
        style={readOnly ? { cursor: 'default' } : undefined}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
}
