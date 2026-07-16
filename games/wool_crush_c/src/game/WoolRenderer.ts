/**
 * Wool Crush gameplay renderer — the Phaser view/input layer over the pure
 * engine. Minimalist per the design directive ("dragon = simplified curving
 * line; do NOT block gameplay on dragon art"): flat shapes, wool-palette
 * colors, readable at phone size. The renderer owns the engine state and
 * REPORTS outcomes; the scene owns the shell seams (winLevel/loseLife).
 */

import Phaser from 'phaser';
import { canRelease, createGame, tapThread, tick, visibleIndices } from './engine';
import { woolLevelForShellId } from './levels';
import type { WoolEvent, WoolState, YarnColor } from './types';
import { SLOT_COUNT } from './types';

const AUTOPLAY = String(import.meta.env.VITE_WOOL_AUTOPLAY) === 'true';

const YARN_HEX: Record<YarnColor, number> = {
  red: 0xe5646e,
  blue: 0x5f9df7,
  green: 0x7ac96f,
  yellow: 0xf6c344,
  purple: 0xc98fe0,
};
const YARN_DARK: Record<YarnColor, number> = {
  red: 0xb23c48,
  blue: 0x3a70c4,
  green: 0x519b47,
  yellow: 0xc79a1e,
  purple: 0x9a63b5,
};

export interface WoolRendererCallbacks {
  onWin: () => void;
  onFail: () => void;
  onBlockedTap: () => void;
  onRelease: () => void;
}

interface ThreadSprite {
  container: Phaser.GameObjects.Container;
  id: string;
}

export class WoolRenderer {
  private scene: Phaser.Scene;
  private cb: WoolRendererCallbacks;
  private state: WoolState;
  private path!: Phaser.Curves.Path;
  private trackGfx!: Phaser.GameObjects.Graphics;
  private dragonGfx!: Phaser.GameObjects.Graphics;
  private slotGfx!: Phaser.GameObjects.Graphics;
  private slotTexts: Phaser.GameObjects.Text[] = [];
  private threadSprites = new Map<string, ThreadSprite>();
  private cat!: Phaser.GameObjects.Container;
  private ended = false;
  private paused = false;

  // Layout (computed in mount from canvas size).
  private W = 0;
  private H = 0;
  private boardTop = 0;
  private cell = 0;
  private boardX = 0;
  private slotY = 0;

  constructor(scene: Phaser.Scene, levelId: string, cb: WoolRendererCallbacks) {
    this.scene = scene;
    this.cb = cb;
    this.state = createGame(woolLevelForShellId(levelId));
  }

  /** Expose a read-only snapshot for the harness/debug. */
  snapshot(): WoolState {
    return this.state;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  mount(): void {
    const cam = this.scene.cameras.main;
    this.W = cam.width;
    this.H = cam.height;
    const topPad = Math.round(this.H * 0.10); // HUD strip
    const trackBottom = Math.round(this.H * 0.44);
    this.slotY = Math.round(this.H * 0.52);
    this.boardTop = Math.round(this.H * 0.60);

    // S-curve track across the top half, cat at the end (bottom-right).
    const m = Math.round(this.W * 0.12);
    const y1 = topPad + (trackBottom - topPad) * 0.16;
    const y2 = topPad + (trackBottom - topPad) * 0.52;
    const y3 = topPad + (trackBottom - topPad) * 0.88;
    const bend = (y2 - y1) * 0.75;
    this.path = new Phaser.Curves.Path(-40, y1);
    this.path.lineTo(this.W - m * 2, y1);
    this.path.cubicBezierTo(
      new Phaser.Math.Vector2(this.W - m * 2, y2),
      new Phaser.Math.Vector2(this.W - m * 2 + bend, y1),
      new Phaser.Math.Vector2(this.W - m * 2 + bend, y2),
    );
    this.path.lineTo(m * 2, y2);
    this.path.cubicBezierTo(
      new Phaser.Math.Vector2(m * 2, y3),
      new Phaser.Math.Vector2(m * 2 - bend, y2),
      new Phaser.Math.Vector2(m * 2 - bend, y3),
    );
    this.path.lineTo(this.W - m * 1.6, y3);

    this.trackGfx = this.scene.add.graphics().setDepth(1);
    this.dragonGfx = this.scene.add.graphics().setDepth(3);
    this.slotGfx = this.scene.add.graphics().setDepth(2);
    this.drawTrack();
    this.buildCat();
    this.buildSlots();
    this.buildBoard();
    this.redrawSlots();
  }

  destroy(): void {
    this.ended = true;
    this.threadSprites.forEach((s) => s.container.destroy());
    this.threadSprites.clear();
    this.trackGfx?.destroy();
    this.dragonGfx?.destroy();
    this.slotGfx?.destroy();
    this.slotTexts.forEach((t) => t.destroy());
    this.cat?.destroy();
  }

  update(deltaMs: number): void {
    if (this.ended || this.paused) return;
    const r = tick(this.state, Math.min(deltaMs, 100));
    this.state = r.state;
    for (const e of r.events) this.applyEvent(e);
    this.drawDragon();
    if (AUTOPLAY) this.autoplayStep(deltaMs);
  }

  /** Demo autoplay (VITE_WOOL_AUTOPLAY=true builds only): plays the level the
   *  way a careful player would — release a legal thread whose color is in
   *  the visible window; otherwise only unblock when slots are mostly free.
   *  Every move goes through the real tap path (tweens, sounds, engine). */
  private autoplayCooldown = 0;
  private autoplayStep(deltaMs: number): void {
    this.autoplayCooldown -= deltaMs;
    if (this.autoplayCooldown > 0) return;
    this.autoplayCooldown = 1100;
    const st = this.state;
    if (!st.slots.some((x) => x === null)) return;
    const visible = new Set(visibleIndices(st).map((i) => st.dragon[i]));
    const releasable = st.threads.filter((t) => canRelease(st, t.id));
    const freeCount = st.slots.filter((x) => x === null).length;
    const pick = releasable.find((t) => visible.has(t.color))
      ?? (freeCount >= 3 ? releasable[0] : undefined);
    if (pick) this.onThreadTap(pick.id);
  }

  private applyEvent(e: WoolEvent): void {
    if (e.kind === 'spoolCompleted' || e.kind === 'sectionPulled') this.redrawSlots();
    if (e.kind === 'won') {
      this.ended = true;
      this.scene.time.delayedCall(420, () => this.cb.onWin());
    }
    if (e.kind === 'failed') {
      this.ended = true;
      this.catPounce();
      this.scene.time.delayedCall(650, () => this.cb.onFail());
    }
  }

  // ── track + dragon ─────────────────────────────────────────────────────────

  private drawTrack(): void {
    const g = this.trackGfx;
    g.clear();
    g.lineStyle(Math.max(16, this.W * 0.034), 0xd9c2a0, 1);
    this.path.draw(g, 96);
    // Cat-end marker: subtle danger pad.
    const end = this.path.getPoint(1);
    g.fillStyle(0xf2b8a0, 0.5);
    g.fillCircle(end.x, end.y, this.W * 0.045);
  }

  private buildCat(): void {
    const end = this.path.getPoint(1);
    const s = this.W * 0.035;
    const body = this.scene.add.circle(0, 0, s, 0x8a7a6e);
    const earL = this.scene.add.triangle(-s * 0.55, -s * 0.8, 0, s * 0.8, s * 0.8, s * 0.8, s * 0.4, 0, 0x8a7a6e);
    const earR = this.scene.add.triangle(s * 0.55, -s * 0.8, 0, s * 0.8, s * 0.8, s * 0.8, s * 0.4, 0, 0x8a7a6e);
    const eyeL = this.scene.add.circle(-s * 0.32, -s * 0.1, s * 0.13, 0xfff6e8);
    const eyeR = this.scene.add.circle(s * 0.32, -s * 0.1, s * 0.13, 0xfff6e8);
    this.cat = this.scene.add.container(end.x, end.y, [earL, earR, body, eyeL, eyeR]).setDepth(4);
    this.scene.tweens.add({ targets: this.cat, y: end.y - 4, duration: 900, yoyo: true, repeat: -1, ease: 'sine.inout' });
  }

  private catPounce(): void {
    this.scene.tweens.add({ targets: this.cat, scale: 1.35, duration: 180, yoyo: true, repeat: 2 });
  }

  private drawDragon(): void {
    const g = this.dragonGfx;
    g.clear();
    const { trackLength } = this.state.def;
    const r = Math.max(11, this.W * 0.024);
    const visible = new Set(visibleIndices(this.state));
    // Body is CONTIGUOUS in pixels: convert the section diameter (with a
    // slight overlap for the braided look) into track units, so sections
    // trail the head like the reference's chunky body — the engine's
    // 1-unit head positions stay authoritative for game logic.
    const unitsPerPx = trackLength / this.path.getLength();
    const spacing = Math.max(0.05, (r * 1.55) * unitsPerPx);
    for (let i = this.state.dragon.length - 1; i >= 0; i -= 1) {
      const pos = this.state.headProgress - i * spacing;
      if (pos < 0 || pos > trackLength) continue;
      const p = this.path.getPoint(Math.min(1, Math.max(0, pos / trackLength)));
      const color = this.state.dragon[i];
      g.fillStyle(YARN_DARK[color], 1);
      g.fillCircle(p.x, p.y + 1.5, r);
      g.fillStyle(YARN_HEX[color], 1);
      g.fillCircle(p.x, p.y, r - 1.5);
      if (!visible.has(i)) {
        g.fillStyle(0xffffff, 0.35); // beyond the pull window: frosted
        g.fillCircle(p.x, p.y, r - 1.5);
      }
    }
    // Head marker: eyes on section 0.
    if (this.state.dragon.length > 0) {
      const pos = this.state.headProgress;
      if (pos >= 0 && pos <= trackLength) {
        const p = this.path.getPoint(Math.min(1, pos / trackLength));
        g.fillStyle(0x3d2d20, 1);
        g.fillCircle(p.x - r * 0.35, p.y - r * 0.25, r * 0.16);
        g.fillCircle(p.x + r * 0.35, p.y - r * 0.25, r * 0.16);
      }
    }
  }

  // ── slots ──────────────────────────────────────────────────────────────────

  private slotRect(i: number): { x: number; y: number; w: number } {
    const w = this.W * 0.17;
    const gap = (this.W - w * SLOT_COUNT) / (SLOT_COUNT + 1);
    return { x: gap + i * (w + gap), y: this.slotY - w * 0.36, w };
  }

  private buildSlots(): void {
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      const r = this.slotRect(i);
      const t = this.scene.add.text(r.x + r.w / 2, r.y + r.w * 0.36, '', {
        fontFamily: 'Fredoka One, sans-serif',
        fontSize: `${Math.round(r.w * 0.3)}px`,
        color: '#ffffff',
      }).setOrigin(0.5).setDepth(5);
      this.slotTexts.push(t);
    }
  }

  private redrawSlots(): void {
    const g = this.slotGfx;
    g.clear();
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      const r = this.slotRect(i);
      const h = r.w * 0.72;
      const spool = this.state.slots[i];
      g.fillStyle(0xffffff, spool ? 0.95 : 0.45);
      g.fillRoundedRect(r.x, r.y, r.w, h, h * 0.3);
      g.lineStyle(3, 0xd9c9b2, 1);
      g.strokeRoundedRect(r.x, r.y, r.w, h, h * 0.3);
      if (spool) {
        g.fillStyle(YARN_HEX[spool.color], 1);
        g.fillCircle(r.x + r.w / 2, r.y + h / 2, h * 0.32);
        g.lineStyle(3, YARN_DARK[spool.color], 1);
        g.strokeCircle(r.x + r.w / 2, r.y + h / 2, h * 0.32);
      }
      this.slotTexts[i].setText(spool ? String(spool.remaining) : '');
    }
  }

  // ── board ──────────────────────────────────────────────────────────────────

  private buildBoard(): void {
    const { cols, rows } = this.state.def;
    const areaW = this.W * 0.9;
    const areaH = this.H * 0.885 - this.boardTop;
    this.cell = Math.floor(Math.min(areaW / cols, areaH / rows));
    this.boardX = Math.round((this.W - this.cell * cols) / 2);

    // Board backdrop.
    const g = this.scene.add.graphics().setDepth(1);
    g.fillStyle(0xffffff, 0.35);
    g.fillRoundedRect(this.boardX - 8, this.boardTop - 8, this.cell * cols + 16, this.cell * rows + 16, 18);

    for (const th of this.state.threads) this.threadSprites.set(th.id, this.buildThread(th.id));
  }

  private buildThread(id: string): ThreadSprite {
    const th = this.state.threads.find((t) => t.id === id)!;
    const horizontal = th.dir === 'left' || th.dir === 'right';
    const wCells = horizontal ? th.length : 1;
    const hCells = horizontal ? 1 : th.length;
    const pad = Math.max(3, this.cell * 0.06);
    const w = wCells * this.cell - pad * 2;
    const h = hCells * this.cell - pad * 2;
    const x = this.boardX + th.x * this.cell + pad;
    const y = this.boardTop + th.y * this.cell + pad;

    const g = this.scene.add.graphics();
    g.fillStyle(YARN_DARK[th.color], 1);
    g.fillRoundedRect(0, 2.5, w, h, Math.min(w, h) * 0.42);
    g.fillStyle(YARN_HEX[th.color], 1);
    g.fillRoundedRect(0, 0, w, h, Math.min(w, h) * 0.42);
    // Yarn wrap bands.
    g.lineStyle(2, YARN_DARK[th.color], 0.5);
    const bands = Math.max(2, Math.round((horizontal ? w : h) / (this.cell * 0.4)));
    for (let b = 1; b < bands; b += 1) {
      if (horizontal) {
        const bx = (w / bands) * b;
        g.lineBetween(bx, 2, bx, h - 2);
      } else {
        const by = (h / bands) * b;
        g.lineBetween(2, by, w - 2, by);
      }
    }
    // Direction arrow.
    const a = Math.min(w, h) * 0.28;
    const cxm = w / 2;
    const cym = h / 2;
    g.fillStyle(0xffffff, 0.9);
    if (th.dir === 'right') g.fillTriangle(w - a * 1.6, cym - a, w - a * 1.6, cym + a, w - a * 0.3, cym);
    if (th.dir === 'left') g.fillTriangle(a * 1.6, cym - a, a * 1.6, cym + a, a * 0.3, cym);
    if (th.dir === 'down') g.fillTriangle(cxm - a, h - a * 1.6, cxm + a, h - a * 1.6, cxm, h - a * 0.3);
    if (th.dir === 'up') g.fillTriangle(cxm - a, a * 1.6, cxm + a, a * 1.6, cxm, a * 0.3);

    const container = this.scene.add.container(x, y, [g]).setDepth(2);
    container.setSize(w, h);
    container.setInteractive(new Phaser.Geom.Rectangle(w / 2, h / 2, w, h), Phaser.Geom.Rectangle.Contains);
    container.on('pointerdown', () => this.onThreadTap(id));
    return { container, id };
  }

  private onThreadTap(id: string): void {
    if (this.ended || this.paused) return;
    const sprite = this.threadSprites.get(id);
    if (!sprite) return;
    const before = this.state;
    const legal = canRelease(before, id);
    const r = tapThread(before, id);
    this.state = r.state;
    const released = r.events.find((e) => e.kind === 'released');
    if (!legal || !released) {
      // Blocked: nudge along its direction and bounce back.
      const th = before.threads.find((t) => t.id === id);
      const dx = th?.dir === 'left' ? -10 : th?.dir === 'right' ? 10 : 0;
      const dy = th?.dir === 'up' ? -10 : th?.dir === 'down' ? 10 : 0;
      this.scene.tweens.add({
        targets: sprite.container,
        x: sprite.container.x + dx,
        y: sprite.container.y + dy,
        duration: 70,
        yoyo: true,
        ease: 'sine.inout',
      });
      this.cb.onBlockedTap();
      return;
    }
    // Released: slide off along its direction, then vanish into the slot.
    const slot = (released as { slot: number }).slot;
    const target = this.slotRect(slot);
    const th = before.threads.find((t) => t.id === id)!;
    const off = this.cell * (th.length + 2);
    const dx = th.dir === 'left' ? -off : th.dir === 'right' ? off : 0;
    const dy = th.dir === 'up' ? -off : th.dir === 'down' ? off : 0;
    this.cb.onRelease();
    this.scene.tweens.add({
      targets: sprite.container,
      x: sprite.container.x + dx,
      y: sprite.container.y + dy,
      alpha: 0.9,
      duration: 130,
      ease: 'sine.in',
      onComplete: () => {
        this.scene.tweens.add({
          targets: sprite.container,
          x: target.x + target.w / 2,
          y: target.y,
          scale: 0.25,
          alpha: 0,
          duration: 160,
          ease: 'sine.out',
          onComplete: () => {
            sprite.container.destroy();
            this.threadSprites.delete(id);
          },
        });
        this.redrawSlots();
      },
    });
  }
}
