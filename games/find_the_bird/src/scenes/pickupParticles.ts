import Phaser from 'phaser';

/** Tap-point particle effects that play on top of the classic pickup fly-out.
 *  Motion ported from the 2026-09-16 procedural candidates Batu picked
 *  (leaf swirl, star ring, feather drift, confetti). One tween per effect
 *  drives every particle from a shared progress value; all coordinates are
 *  scroll-factor-0 screen pixels. */

export type PickupFx = 'leaf' | 'stars' | 'feathers' | 'confetti';
export const PICKUP_FX_KINDS: readonly PickupFx[] = ['leaf', 'stars', 'feathers', 'confetti'];
/** Generated feather cutouts (magenta-key lane, gpt-image-2.5-sunburst, 2026-09-16). */
export const PICKUP_FEATHER_KEYS = [
  'feather2_cream', 'feather2_brown', 'feather2_blue', 'feather2_olive', 'feather2_rose', 'feather2_sunset',
] as const;

/** Screen-space scale: the candidates were authored on a 520 px crop where the
 *  bird was ~150 px; on the phone the bird is ~100 px. */
const K = 0.7;
const DEPTH = 86;

const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/** Deterministic per-effect randomness so a given seed always looks the same. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function ensureShapeTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists('pfx-leaf')) {
    const g = scene.add.graphics();
    // Leaf: white rhombus with a dark outline; tinted per particle.
    g.lineStyle(3, 0x141414, 1).fillStyle(0xffffff, 1);
    g.beginPath(); g.moveTo(34, 18); g.lineTo(18, 26); g.lineTo(2, 18); g.lineTo(18, 10); g.closePath();
    g.fillPath(); g.strokePath();
    g.generateTexture('pfx-leaf', 36, 36);
    g.destroy();
  }
  if (!scene.textures.exists('pfx-star')) {
    const g = scene.add.graphics();
    g.lineStyle(3, 0x141414, 1).fillStyle(0xffffff, 1);
    g.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const r = i % 2 === 0 ? 17 : 7;
      const a = -Math.PI / 2 + (i * Math.PI) / 4;
      const x = 20 + r * Math.cos(a);
      const y = 20 + r * Math.sin(a);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fillPath(); g.strokePath();
    g.generateTexture('pfx-star', 40, 40);
    g.destroy();
  }
  if (!scene.textures.exists('pfx-chip')) {
    const g = scene.add.graphics();
    g.lineStyle(2, 0x141414, 1).fillStyle(0xffffff, 1);
    g.fillRect(2, 2, 20, 12); g.strokeRect(2, 2, 20, 12);
    g.generateTexture('pfx-chip', 24, 16);
    g.destroy();
  }
}

interface Runner {
  images: Phaser.GameObjects.Image[];
  durationMs: number;
  update: (t: number) => void; // t in seconds
}

function leafSwirl(scene: Phaser.Scene, px: number, py: number): Runner {
  const r = rng(1);
  const colours = [0x78c85a, 0xe6aa3c, 0xf07850, 0xa0dc78];
  const parts = Array.from({ length: 14 }, (_, i) => ({
    ph: r() * 6.28, sp: 0.6 + r() * 0.5, colour: colours[Math.floor(r() * colours.length)], delay: r() * 0.08,
    img: scene.add.image(px, py, 'pfx-leaf').setScrollFactor(0).setDepth(DEPTH + (i % 2)).setAlpha(0),
  }));
  for (const p of parts) p.img.setTint(p.colour);
  return {
    images: parts.map((p) => p.img),
    durationMs: 800,
    update: (t) => {
      const fade = 1 - clamp01((t - 0.55) / 0.25);
      for (const p of parts) {
        const tt = clamp01((t - p.delay) / 0.75);
        if (tt <= 0) { p.img.setAlpha(0); continue; }
        const e = easeOut(tt);
        const rad = (18 + e * 60) * K;
        const ang = p.ph + e * 5 * p.sp;
        const up = e * e * 120 * K;
        p.img.setPosition(px + rad * Math.cos(ang), py + rad * Math.sin(ang) * 0.55 - up);
        p.img.setScale(((26 - 8 * e) / 26) * K * 1.4);
        p.img.setRotation(ang + t * 8);
        p.img.setAlpha(fade);
      }
    },
  };
}

function starRing(scene: Phaser.Scene, px: number, py: number): Runner {
  const parts = Array.from({ length: 9 }, (_, i) => ({
    a: (i * 6.28) / 9 - 1.57, delay: i * 0.02,
    img: scene.add.image(px, py, 'pfx-star').setScrollFactor(0).setDepth(DEPTH).setAlpha(0).setTint(i % 2 ? 0xffe650 : 0xffffff),
  }));
  return {
    images: parts.map((p) => p.img),
    durationMs: 800,
    update: (t) => {
      const fade = 1 - clamp01((t - 0.65) / 0.15);
      for (const p of parts) {
        const tt = t - p.delay;
        if (tt < 0) { p.img.setAlpha(0); continue; }
        const pop = easeOut(clamp01(tt / 0.25));
        const rad = (20 + pop * 70) * K;
        const fall = Math.max(0, tt - 0.3);
        p.img.setPosition(
          px + rad * Math.cos(p.a) + fall * 20 * Math.cos(p.a) * K,
          py + rad * Math.sin(p.a) + 220 * fall * fall * K,
        );
        const size = (6 + 18 * pop) * (tt < 0.3 ? 1 : Math.max(0.25, 1 - (tt - 0.3) * 1.6));
        p.img.setScale((size / 17) * K * 1.3);
        p.img.setRotation(tt * 5);
        p.img.setAlpha(fade);
      }
    },
  };
}

function featherDrift(scene: Phaser.Scene, px: number, py: number): Runner {
  const r = rng(5);
  const keys = PICKUP_FEATHER_KEYS.filter((k) => scene.textures.exists(k));
  const parts = Array.from({ length: 7 }, (_, i) => {
    const key = keys.length ? keys[i % keys.length] : 'pickup-feather';
    return {
      ox: (r() * 180 - 90) * K, delay: r() * 0.1, sway: 1.5 + r() * 1.5, ph: r() * 6, oy: (r() * 50 - 40) * K,
      img: scene.add.image(px, py, key).setScrollFactor(0).setDepth(DEPTH + (i % 2)).setAlpha(0),
    };
  });
  for (const p of parts) {
    const h = p.img.height || 40;
    p.img.setScale((44 * K) / h);
  }
  return {
    images: parts.map((p) => p.img),
    durationMs: 900,
    update: (t) => {
      const fade = 1 - clamp01((t - 0.6) / 0.25);
      for (const p of parts) {
        const tt = t - p.delay;
        if (tt < 0) { p.img.setAlpha(0); continue; }
        const y = py + p.oy - 120 * tt * K + 330 * tt * tt * K;
        const x = px + p.ox * (1 + tt * 0.8) + 26 * K * Math.sin(p.ph + tt * p.sway * 3.14);
        p.img.setPosition(x, y);
        p.img.setRotation(0.5 * Math.sin(p.ph + tt * p.sway * 3.14));
        p.img.setAlpha(fade);
      }
    },
  };
}

function confetti(scene: Phaser.Scene, px: number, py: number): Runner {
  const r = rng(6);
  const colours = [0xff5a5a, 0x5ab4ff, 0xffdc3c, 0x78dc78, 0xe678e6];
  const parts = Array.from({ length: 18 }, (_, i) => ({
    a: r() * 6.28, v: (100 + r() * 100) * K * 1.4, colour: colours[Math.floor(r() * colours.length)],
    img: scene.add.image(px, py, 'pfx-chip').setScrollFactor(0).setDepth(DEPTH + (i % 2)).setAlpha(0),
  }));
  for (const p of parts) p.img.setTint(p.colour).setScale(1.4 * K);
  return {
    images: parts.map((p) => p.img),
    durationMs: 800,
    update: (t) => {
      const fade = 1 - clamp01((t - 0.55) / 0.2);
      for (const p of parts) {
        const tt = clamp01(t / 0.8);
        p.img.setPosition(
          px + p.v * tt * Math.cos(p.a),
          py + p.v * tt * Math.sin(p.a) - 90 * tt * K + 260 * tt * tt * K,
        );
        p.img.setRotation(tt * 9 + p.a);
        p.img.setAlpha(fade);
      }
    },
  };
}

/** Play one effect at a scroll-factor-0 screen point. Returns immediately; particles self-destroy. */
export function playPickupParticles(scene: Phaser.Scene, kind: PickupFx, x: number, y: number): void {
  ensureShapeTextures(scene);
  const runner = kind === 'leaf' ? leafSwirl(scene, x, y)
    : kind === 'stars' ? starRing(scene, x, y)
    : kind === 'feathers' ? featherDrift(scene, x, y)
    : confetti(scene, x, y);
  const startedAt = performance.now();
  const progress = { t: 0 };
  scene.tweens.add({
    targets: progress,
    t: 1,
    duration: runner.durationMs,
    ease: 'Linear',
    onUpdate: () => runner.update((performance.now() - startedAt) / 1000),
    onComplete: () => { for (const img of runner.images) img.destroy(); },
  });
}

export function pickRandomPickupFx(): PickupFx {
  return PICKUP_FX_KINDS[Math.floor(Math.random() * PICKUP_FX_KINDS.length)];
}
