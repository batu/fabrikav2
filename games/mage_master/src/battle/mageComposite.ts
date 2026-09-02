import type { Element } from "../../content/items.ts";
import type { MageClass } from "../../content/mages.ts";
import type { Rarity } from "../../content/rarity.ts";
import { garmentSprite, mageAnchor, unitSprite, weaponIcon } from "../../design/assets.ts";

/**
 * Layered mage look: base body + garment layer tinted by armor rarity + the
 * element staff placed in the raised hand. One composite serves both the DOM
 * (<img src=dataURL>) and Phaser (canvas texture). Gear visuals scale as data.
 */
export interface MageLook {
  readonly cls: MageClass;
  readonly element: Element;
  readonly armorRarity: Rarity;
}

export const COMPOSITE_SIZE = 512;

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const compositeCache = new Map<string, HTMLCanvasElement>();
const pending = new Map<string, Promise<HTMLCanvasElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load ${url}`));
    image.src = url;
  });
  imageCache.set(url, promise);
  return promise;
}

export function lookKey(look: MageLook): string {
  return `${look.cls}|${look.element}|${look.armorRarity}`;
}

function rarityColor(rarity: Rarity): string {
  const style = getComputedStyle(document.documentElement);
  return style.getPropertyValue(`--fab-mm-rarity-${rarity}`).trim() || "#ffffff";
}

/** Draw the composite; resolves to a cached canvas per look. */
export function composeMage(look: MageLook): Promise<HTMLCanvasElement> {
  const key = lookKey(look);
  const done = compositeCache.get(key);
  if (done) return Promise.resolve(done);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const promise = (async () => {
    const baseUrl = unitSprite(look.cls);
    const garmentUrl = garmentSprite(look.cls);
    const staffUrl = weaponIcon(look.element);
    const canvas = document.createElement("canvas");
    canvas.width = COMPOSITE_SIZE;
    canvas.height = COMPOSITE_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    const [base, garment, staff] = await Promise.all([
      baseUrl ? loadImage(baseUrl) : null,
      garmentUrl ? loadImage(garmentUrl) : null,
      staffUrl ? loadImage(staffUrl) : null,
    ]);
    const anchor = mageAnchor(look.cls);
    // Staff behind the hand when the anchor says so (hand grips it).
    const drawStaff = (): void => {
      if (!staff) return;
      const size = COMPOSITE_SIZE * anchor.staffScale;
      ctx.save();
      ctx.translate(anchor.x * COMPOSITE_SIZE, anchor.y * COMPOSITE_SIZE);
      ctx.rotate((anchor.staffAngle * Math.PI) / 180);
      ctx.drawImage(staff, -size * anchor.staffPivotX, -size * anchor.staffPivotY, size, size);
      ctx.restore();
    };
    if (anchor.staffBehind) drawStaff();
    if (base) ctx.drawImage(base, 0, 0, COMPOSITE_SIZE, COMPOSITE_SIZE);
    if (garment) {
      const tint = document.createElement("canvas");
      tint.width = COMPOSITE_SIZE;
      tint.height = COMPOSITE_SIZE;
      const tctx = tint.getContext("2d");
      if (tctx) {
        tctx.drawImage(garment, 0, 0, COMPOSITE_SIZE, COMPOSITE_SIZE);
        tctx.globalCompositeOperation = "multiply";
        tctx.fillStyle = rarityColor(look.armorRarity);
        tctx.fillRect(0, 0, COMPOSITE_SIZE, COMPOSITE_SIZE);
        tctx.globalCompositeOperation = "destination-in";
        tctx.drawImage(garment, 0, 0, COMPOSITE_SIZE, COMPOSITE_SIZE);
        ctx.drawImage(tint, 0, 0);
      }
    }
    if (!anchor.staffBehind) drawStaff();
    compositeCache.set(key, canvas);
    pending.delete(key);
    return canvas;
  })();
  pending.set(key, promise);
  return promise;
}

export function composeMageUrl(look: MageLook): Promise<string> {
  return composeMage(look).then((canvas) => canvas.toDataURL("image/png"));
}

export function cachedComposite(look: MageLook): HTMLCanvasElement | null {
  return compositeCache.get(lookKey(look)) ?? null;
}
