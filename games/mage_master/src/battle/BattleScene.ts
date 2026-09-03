import Phaser from "phaser";
import { ARENA } from "../../content/economy.ts";
import { ARENA_THEME, levelSpec } from "../../content/levels.ts";
import type { Element } from "../../content/items.ts";
import { THEME_PROPS, allPropSprites, allUnitSprites, groundScene, propSprite, spriteFacing } from "../../design/assets.ts";
import { copy, fill } from "../../design/copy.ts";
import type { MageMasterController } from "../game/MageMasterController.ts";
import type { BattleEvent, BattleView, Unit } from "../game/sim/types.ts";
import { cachedComposite, COMPOSITE_SIZE, lookKey, type MageLook } from "./mageComposite.ts";
import { readPalette } from "./palette.ts";
import type { Sfx } from "../game/sfx.ts";

/** Base sprite height in world units for a scale-1 unit. */
const UNIT_HEIGHT = 74;
const HP_BAR_WIDTH = 40;
const DEPTH = { ground: 0, shadow: 1, unit: 10, projectile: 40, fx: 50, text: 60, banner: 80 } as const;

interface UnitVisual {
  readonly id: string;
  readonly root: Phaser.GameObjects.Container;
  readonly sprite: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Ellipse;
  readonly hpBar: Phaser.GameObjects.Graphics | null;
  readonly offset: { x: number; y: number };
  readonly squash: { x: number; y: number };
  readonly baseScale: number;
  bobPhase: number;
  flash: number;
  /** Scene time of the last flash, to rate-limit flashes on rapid hits. */
  lastFlashAt: number;
  burn: Phaser.GameObjects.Particles.ParticleEmitter | null;
  dead: boolean;
}

export interface BattleRendererOptions {
  readonly container: HTMLElement;
  readonly controller: MageMasterController;
  /** Called every frame with the fresh view (HUD binding). */
  readonly onFrame?: (view: BattleView) => void;
  /** Gear looks per mage class; composites must be drawn (composeMage) before boot. */
  readonly partyLooks?: Partial<Record<string, MageLook>>;
  readonly sfx?: Sfx;
  /** Minimal interface: flat ground, no props, no vignette. */
  readonly minimal?: boolean;
}

export interface BattleRenderer {
  destroy(): void;
  /** Capture N consecutive frames of the canvas as PNG data URLs (motion evidence). */
  captureFrames(count: number, everyMs: number): Promise<string[]>;
  readonly canvas: HTMLCanvasElement | null;
}

function elementColor(palette: (k: string) => number, element: Element | null): number {
  return palette(element ? `element-${element}` : "cream");
}

class Scene extends Phaser.Scene {
  private readonly controller: MageMasterController;
  private readonly onFrame?: (view: BattleView) => void;
  private readonly partyLooks: Partial<Record<string, MageLook>>;
  private readonly sfx: Sfx | null;
  private readonly minimal: boolean;
  /** Visible world height (the host's aspect at arena width). */
  private readonly viewH: number;
  private readonly palette = readPalette();
  private visuals = new Map<string, UnitVisual>();
  private units = new Map<string, Unit>();
  private textPool: Phaser.GameObjects.Text[] = [];
  private floatSlots = new Map<string, number>();
  private cameraY = 0;
  private cameraTargetY = 0;
  private ground!: Phaser.GameObjects.TileSprite;
  private ledges: Phaser.GameObjects.Graphics[] = [];
  private crystals!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private coins!: Phaser.GameObjects.Particles.ParticleEmitter;
  private time0 = 0;

  constructor(controller: MageMasterController, onFrame: ((view: BattleView) => void) | undefined, partyLooks: Partial<Record<string, MageLook>>, sfx: Sfx | null, viewH: number, minimal: boolean) {
    super("battle");
    this.controller = controller;
    this.onFrame = onFrame;
    this.partyLooks = partyLooks;
    this.sfx = sfx;
    this.viewH = viewH;
    this.minimal = minimal;
  }

  /** World y at the top of the viewport for the current camera scroll. */
  private viewTop(): number {
    return this.cameraY + ARENA.campLineY + 44 - this.viewH;
  }

  preload(): void {
    for (const [kind, url] of Object.entries(allUnitSprites())) this.load.image(`unit-${kind}`, url);
    for (const theme of ["sand", "forest", "swamp"]) {
      const url = groundScene(theme);
      if (url) this.load.image(`ground-${theme}`, url);
    }
    for (const prop of ["campfire", "tent"] as const) {
      const url = propSprite(prop);
      if (url) this.load.image(`prop-${prop}`, url);
    }
    for (const [name, url] of Object.entries(allPropSprites())) {
      if (!this.textures.exists(`prop-${name}`)) this.load.image(`prop-${name}`, url);
    }
  }

  /** Scatter theme props across one stage's field, deterministic per stage. */
  private dressField(fieldTop: number, stageIndex: number): void {
    if (this.minimal) return;
    const names = THEME_PROPS[this.theme()] ?? [];
    const available = names.filter((n) => this.textures.exists(`prop-${n}`));
    if (available.length === 0) return;
    let seed = 1234 + stageIndex * 97 + (this.controller.battleView()?.level ?? 1) * 13;
    const rnd = (): number => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const count = 8;
    for (let i = 0; i < count; i += 1) {
      const name = available[Math.floor(rnd() * available.length)] ?? available[0];
      if (!name) continue;
      // Alternate sides so both flanks are dressed; keep the fighting lanes and the camp clear.
      const left = i % 2 === 0;
      const x = left ? 52 + rnd() * 50 : ARENA.width - 24 - rnd() * 60;
      const y = fieldTop + 90 + rnd() * (ARENA.height - 240);
      const size = 30 + rnd() * 22;
      this.add
        .image(x, y, `prop-${name}`)
        .setOrigin(0.5, 1)
        .setDisplaySize(size, size)
        .setDepth(DEPTH.ground + 1 + y / 100000)
        .setFlipX(rnd() < 0.5)
        .setAlpha(0.95);
    }
  }

  private theme(): string {
    const view = this.controller.battleView();
    return view ? ARENA_THEME[levelSpec(view.level).family] : "sand";
  }

  create(): void {
    const p = this.palette;
    this.makeTextures();
    const groundKey = !this.minimal && this.textures.exists(`ground-${this.theme()}`) ? `ground-${this.theme()}` : "ground";
    this.ground = this.add
      .tileSprite(ARENA.width / 2, ARENA.height / 2, ARENA.width, ARENA.height * 3, groundKey)
      .setDepth(DEPTH.ground);
    if (groundKey !== "ground") {
      // Painted plate: scale the 768 px tile to the arena width so it repeats vertically.
      const src = this.textures.get(groundKey).getSourceImage() as { width: number };
      this.ground.setTileScale(ARENA.width / src.width);
    }
    this.sparks = this.add.particles(0, 0, "dot", {
      speed: { min: 60, max: 180 },
      scale: { start: 0.5, end: 0 },
      lifespan: 320,
      quantity: 6,
      emitting: false,
    }).setDepth(DEPTH.fx);
    this.dust = this.add.particles(0, 0, "dot", {
      speed: { min: 20, max: 70 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.7, end: 0 },
      lifespan: 500,
      quantity: 8,
      tint: p(`ground-${this.theme()}-deep`),
      emitting: false,
    }).setDepth(DEPTH.shadow + 1);
    this.coins = this.add.particles(0, 0, "coin", {
      speedY: { min: -220, max: -140 },
      speedX: { min: -60, max: 60 },
      gravityY: 380,
      scale: { start: 0.9, end: 0.6 },
      alpha: { start: 1, end: 0 },
      lifespan: 700,
      quantity: 3,
      emitting: false,
    }).setDepth(DEPTH.fx);
    this.crystals = this.add.particles(0, 0, "shard", {
      speedY: { min: -260, max: -170 },
      speedX: { min: -70, max: 70 },
      gravityY: 420,
      rotate: { min: -180, max: 180 },
      scale: { start: 1, end: 0.7 },
      alpha: { start: 1, end: 0 },
      lifespan: 800,
      quantity: 4,
      emitting: false,
    }).setDepth(DEPTH.fx);
    this.cameras.main.setBackgroundColor(p(`ground-${this.theme()}`));
    this.cameraY = 0;
    this.cameraTargetY = 0;
    this.cameras.main.setZoom(this.zoom());
    this.time0 = this.time.now;
    this.drawLedge(ARENA.campLineY);
    this.dressField(0, 0);
    if (this.minimal) return;
    // Edge vignette: a screen-fixed frame that darkens the borders slightly.
    const vignette = this.add.graphics().setScrollFactor(0).setDepth(DEPTH.banner - 1);
    const vw = ARENA.width;
    const vh = this.viewH;
    for (let i = 0; i < 6; i += 1) {
      vignette.lineStyle(10, p("ink"), 0.035 * (6 - i));
      vignette.strokeRect(5 + i * 9, 5 + i * 9, vw - 10 - i * 18, vh - 10 - i * 18);
    }
  }

  private zoom(): number {
    return this.scale.width / ARENA.width;
  }

  private makeTextures(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 8);
    g.generateTexture("dot", 16, 16);
    g.clear();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(12, 12, 12);
    g.fillStyle(0xffffff, 0.55);
    g.fillCircle(12, 12, 20);
    g.generateTexture("orb", 40, 40);
    g.clear();
    g.fillStyle(this.palette("gold"), 1);
    g.fillCircle(9, 9, 9);
    g.lineStyle(2, this.palette("ink"), 1);
    g.strokeCircle(9, 9, 8);
    g.generateTexture("coin", 18, 18);
    g.clear();
    g.lineStyle(3, 0xffffff, 1);
    g.strokeCircle(24, 24, 22);
    g.generateTexture("ring", 48, 48);
    g.clear();
    // Crystal shard: a small diamond.
    g.fillStyle(this.palette("crystal"), 1);
    g.fillPoints([{ x: 8, y: 0 }, { x: 16, y: 8 }, { x: 8, y: 20 }, { x: 0, y: 8 }], true);
    g.lineStyle(2, this.palette("ink"), 1);
    g.strokePoints([{ x: 8, y: 0 }, { x: 16, y: 8 }, { x: 8, y: 20 }, { x: 0, y: 8 }], true);
    g.generateTexture("shard", 16, 20);
    g.clear();
    // Ground: flat field with sparse darker speckles (flat, no gradient), themed per enemy family.
    const size = 128;
    const theme = this.theme();
    g.fillStyle(this.palette(`ground-${theme}`), 1);
    g.fillRect(0, 0, size, size);
    g.fillStyle(this.palette(`ground-${theme}-deep`), 1);
    const seed = 7;
    let s = seed;
    const rnd = (): number => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i < 26; i += 1) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 1.5 + rnd() * 3;
      g.fillEllipse(x, y, r * 2.6, r);
    }
    g.generateTexture("ground", size, size);
    g.clear();
    // Placeholder unit for missing art.
    g.fillStyle(this.palette("ink"), 1);
    g.fillRoundedRect(4, 4, 56, 72, 12);
    g.fillStyle(this.palette("cream"), 1);
    g.fillRoundedRect(8, 8, 48, 64, 10);
    g.generateTexture("unit-missing", 64, 80);
    g.destroy();
  }

  private drawLedge(campY: number): void {
    const p = this.palette;
    const g = this.add.graphics().setDepth(DEPTH.ground + 1);
    const top = campY + 26;
    g.fillStyle(p("ledge-edge"), 1);
    g.fillEllipse(ARENA.width / 2, top + 30, ARENA.width * 1.5, 120);
    g.fillStyle(p("ledge"), 1);
    g.fillEllipse(ARENA.width / 2, top + 36, ARENA.width * 1.5, 120);
    g.fillRect(-ARENA.width, top + 36, ARENA.width * 3, ARENA.height);
    this.ledges.push(g);
    // Camp props sit on the ledge behind the party.
    if (this.minimal) return;
    if (this.textures.exists("prop-tent")) {
      this.add.image(ARENA.width * 0.12, campY + 28, "prop-tent").setOrigin(0.5, 1).setDisplaySize(64, 64).setDepth(DEPTH.ground + 2);
    }
    if (this.textures.exists("prop-campfire")) {
      const fire = this.add.image(ARENA.width * 0.88, campY + 30, "prop-campfire").setOrigin(0.5, 1).setDisplaySize(44, 44).setDepth(DEPTH.ground + 2);
      this.tweens.add({ targets: fire, scaleX: fire.scaleX * 1.06, scaleY: fire.scaleY * 0.94, duration: 260, yoyo: true, repeat: -1, ease: "Sine.inOut" });
      const embers = this.add.particles(fire.x, fire.y - 30, "dot", {
        speedY: { min: -40, max: -20 },
        speedX: { min: -8, max: 8 },
        scale: { start: 0.25, end: 0 },
        alpha: { start: 0.8, end: 0 },
        lifespan: 700,
        frequency: 140,
        tint: [p("element-fire"), p("gold")],
      }).setDepth(DEPTH.ground + 3);
      this.ledges.push(embers as unknown as Phaser.GameObjects.Graphics);
    }
  }

  /** Texture key plus the body height to scale against (null = the whole texture). */
  private textureFor(kind: string): { key: string; bodyHeight: number | null } {
    const look = this.partyLooks[kind];
    if (look) {
      const key = `look-${lookKey(look)}`;
      if (!this.textures.exists(key)) {
        const canvas = cachedComposite(look);
        if (canvas) this.textures.addCanvas(key, canvas);
      }
      // Composites carry transparent headroom for the raised staff; the figure is the
      // bottom square, so scale against that to match the plain unit sprites.
      if (this.textures.exists(key)) return { key, bodyHeight: COMPOSITE_SIZE };
    }
    return { key: this.textures.exists(`unit-${kind}`) ? `unit-${kind}` : "unit-missing", bodyHeight: null };
  }

  private ensureVisual(unit: Unit): UnitVisual {
    const existing = this.visuals.get(unit.id);
    if (existing) return existing;
    const p = this.palette;
    const height = UNIT_HEIGHT * unit.scale * (unit.side === "party" ? 1.18 : 1);
    const texture = this.textureFor(unit.kind);
    const sprite = this.add.image(0, 0, texture.key).setOrigin(0.5, 1);
    const scale = height / (texture.bodyHeight ?? sprite.height);
    sprite.setScale(scale);
    const shadow = this.add.ellipse(0, 2, height * 0.62, height * 0.2, p("ink"), 0.22);
    const root = this.add.container(unit.pos.x, unit.pos.y, [shadow, sprite]).setDepth(DEPTH.unit + unit.pos.y / 1000);
    let hpBar: Phaser.GameObjects.Graphics | null = null;
    if (unit.side === "enemy") {
      hpBar = this.add.graphics();
      root.add(hpBar);
    }
    const visual: UnitVisual = {
      id: unit.id,
      root,
      sprite,
      shadow,
      hpBar,
      offset: { x: 0, y: 0 },
      squash: { x: 1, y: 1 },
      baseScale: scale,
      bobPhase: Math.random() * Math.PI * 2,
      flash: 0,
      lastFlashAt: -1,
      burn: null,
      dead: false,
    };
    this.visuals.set(unit.id, visual);
    // Spawn pop.
    root.setScale(0.55);
    this.tweens.add({ targets: root, scale: 1, duration: 200, ease: "Back.out" });
    if (unit.side === "enemy") this.dust.explode(6, unit.pos.x, unit.pos.y);
    return visual;
  }

  private drawHp(visual: UnitVisual, unit: Unit): void {
    if (!visual.hpBar) return;
    const p = this.palette;
    const g = visual.hpBar;
    const height = UNIT_HEIGHT * unit.scale;
    const w = HP_BAR_WIDTH * (unit.boss ? 1.6 : 1);
    const y = -height - 10;
    g.clear();
    if (unit.hp >= unit.maxHp || !unit.alive) return;
    g.fillStyle(p("hp-track"), 0.9);
    g.fillRoundedRect(-w / 2 - 1, y - 1, w + 2, 6, 3);
    g.fillStyle(p("hp"), 1);
    g.fillRoundedRect(-w / 2, y, Math.max(2, (w * unit.hp) / unit.maxHp), 4, 2);
  }

  private floatText(x: number, y: number, text: string, color: number, opts: { size?: number; crit?: boolean; slotKey?: string } = {}): void {
    const t = this.textPool.pop() ?? this.add.text(0, 0, "", { fontFamily: "Arial Rounded MT Bold, system-ui, sans-serif" }).setDepth(DEPTH.text);
    const size = opts.size ?? (opts.crit ? 24 : 17);
    // Spread rapid numbers on the same target so they do not stack into a blob.
    const key = opts.slotKey ?? "";
    const slot = key ? (this.floatSlots.get(key) ?? 0) : 0;
    if (key) this.floatSlots.set(key, (slot + 1) % 5);
    const spreadX = key ? [0, -22, 22, -12, 12][slot] ?? 0 : (Math.random() - 0.5) * 14;
    const spreadY = key ? [0, -10, -10, -20, -20][slot] ?? 0 : 0;
    t.setText(text)
      .setStyle({ fontSize: `${size}px`, fontStyle: "bold", color: `#${color.toString(16).padStart(6, "0")}`, stroke: `#${this.palette("ink").toString(16).padStart(6, "0")}`, strokeThickness: 5 })
      .setOrigin(0.5, 1)
      .setPosition(x + spreadX, y + spreadY)
      .setAlpha(1)
      .setScale(opts.crit ? 0.6 : 0.9)
      .setActive(true)
      .setVisible(true);
    this.tweens.add({ targets: t, scale: opts.crit ? 1.25 : 1, duration: 120, ease: "Back.out" });
    this.tweens.add({
      targets: t,
      y: y - 46,
      alpha: 0,
      duration: 720,
      delay: 90,
      ease: "Quad.out",
      onComplete: () => {
        t.setActive(false).setVisible(false);
        this.textPool.push(t);
      },
    });
  }

  private banner(text: string, color: number): void {
    const cam = this.cameras.main;
    const y = cam.midPoint.y - 120;
    const t = this.add
      .text(ARENA.width / 2, y, text, {
        fontFamily: "Arial Rounded MT Bold, system-ui, sans-serif",
        fontSize: "34px",
        color: `#${color.toString(16).padStart(6, "0")}`,
        stroke: `#${this.palette("ink").toString(16).padStart(6, "0")}`,
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.banner)
      .setScale(0.4)
      .setAlpha(0);
    this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 220, ease: "Back.out" });
    this.tweens.add({ targets: t, alpha: 0, y: y - 30, duration: 400, delay: 900, onComplete: () => t.destroy() });
  }

  private handle(event: BattleEvent): void {
    const p = this.palette;
    switch (event.type) {
      case "spawn": {
        const unit = this.units.get(event.unitId);
        if (unit) {
          this.ensureVisual(unit);
          if (unit.boss) {
            this.cameras.main.shake(260, 0.006);
            this.banner(copy["battle.boss"], p("danger"));
            this.sfx?.play("boss");
          }
        }
        break;
      }
      case "attack": {
        const v = this.visuals.get(event.unitId);
        const target = this.units.get(event.targetId);
        if (!v || !target) break;
        const unit = this.units.get(event.unitId);
        const dx = target.pos.x - (unit?.pos.x ?? 0);
        const dy = target.pos.y - (unit?.pos.y ?? 0);
        const len = Math.hypot(dx, dy) || 1;
        const nx = dx / len;
        const ny = dy / len;
        if (event.range === "melee") {
          // Anticipation, lunge, settle.
          this.tweens.chain({
            targets: v.offset,
            tweens: [
              { x: -nx * 6, y: -ny * 6, duration: 70, ease: "Quad.out" },
              { x: nx * 16, y: ny * 16, duration: 80, ease: "Back.out" },
              { x: 0, y: 0, duration: 170, ease: "Quad.out" },
            ],
          });
          this.tweens.chain({
            targets: v.squash,
            tweens: [
              { x: 0.9, y: 1.12, duration: 70 },
              { x: 1.15, y: 0.88, duration: 80 },
              { x: 1, y: 1, duration: 170, ease: "Quad.out" },
            ],
          });
        } else {
          this.tweens.chain({
            targets: v.squash,
            tweens: [
              { x: 1.12, y: 0.92, duration: 60 },
              { x: 1, y: 1, duration: 180, ease: "Quad.out" },
            ],
          });
          this.tweens.chain({
            targets: v.offset,
            tweens: [
              { x: -nx * 4, y: -ny * 4, duration: 60 },
              { x: 0, y: 0, duration: 180, ease: "Quad.out" },
            ],
          });
        }
        break;
      }
      case "projectile": {
        const source = this.units.get(event.sourceId);
        const target = this.units.get(event.targetId);
        if (!source || !target) break;
        const color = elementColor(p, event.element);
        const orb = this.add.image(source.pos.x, source.pos.y - UNIT_HEIGHT * 0.55, "orb").setTint(color).setDepth(DEPTH.projectile).setScale(0.5);
        const trail = this.add.particles(0, 0, "dot", {
          follow: orb,
          speed: 10,
          scale: { start: 0.35, end: 0 },
          alpha: { start: 0.8, end: 0 },
          lifespan: 220,
          frequency: 18,
          tint: color,
        }).setDepth(DEPTH.projectile - 1);
        const ms = event.seconds * 1000;
        const arc = -Math.min(60, Math.hypot(target.pos.x - source.pos.x, target.pos.y - source.pos.y) * 0.18);
        const progress = { t: 0 };
        const from = { x: orb.x, y: orb.y };
        this.tweens.add({
          targets: progress,
          t: 1,
          duration: ms,
          onUpdate: () => {
            const live = this.units.get(event.targetId) ?? target;
            const tx = live.pos.x;
            const ty = live.pos.y - UNIT_HEIGHT * 0.45 * live.scale;
            const k = progress.t;
            orb.x = from.x + (tx - from.x) * k;
            orb.y = from.y + (ty - from.y) * k + arc * 4 * k * (1 - k);
          },
          onComplete: () => {
            this.sparks.setParticleTint(color);
            this.sparks.explode(8, orb.x, orb.y);
            trail.stop();
            this.time.delayedCall(260, () => trail.destroy());
            orb.destroy();
          },
        });
        break;
      }
      case "hit": {
        const v = this.visuals.get(event.targetId);
        const target = this.units.get(event.targetId);
        if (!v || !target) break;
        const source = this.units.get(event.sourceId);
        const dx = source ? target.pos.x - source.pos.x : 0;
        const dy = source ? target.pos.y - source.pos.y : -1;
        const len = Math.hypot(dx, dy) || 1;
        // Flash on the first hit of a burst (or any crit); constant flashing reads as a white blob.
        const sinceFlash = this.time.now - v.lastFlashAt;
        if (event.kind !== "burn" && (event.crit || sinceFlash > 260)) {
          v.flash = 1;
          v.lastFlashAt = this.time.now;
        }
        if (event.kind !== "burn") {
          const kick = event.crit ? 12 : 7;
          this.tweens.chain({
            targets: v.offset,
            tweens: [
              { x: (dx / len) * kick, y: (dy / len) * kick, duration: 60, ease: "Quad.out" },
              { x: 0, y: 0, duration: 160, ease: "Quad.out" },
            ],
          });
          this.tweens.chain({
            targets: v.squash,
            tweens: [
              { x: 1.18, y: 0.84, duration: 60 },
              { x: 1, y: 1, duration: 180, ease: "Back.out" },
            ],
          });
        }
        if (event.kind !== "burn") this.sfx?.play(event.crit ? "crit" : "hit");
        const color = event.crit ? p("gold") : target.side === "party" ? p("hp") : event.element ? elementColor(p, event.element) : 0xffffff;
        const label = `${event.blocked ? "-" : ""}${event.amount}${event.crit ? "!" : ""}`;
        this.floatText(target.pos.x, target.pos.y - UNIT_HEIGHT * target.scale * 0.9, label, color, { crit: event.crit, size: event.kind === "burn" ? 12 : undefined, slotKey: target.id });
        if (event.crit && target.side === "party") this.cameras.main.shake(120, 0.004);
        if (event.kind === "aoe") {
          const ring = this.add.image(target.pos.x, target.pos.y - 10, "ring").setTint(color).setDepth(DEPTH.fx).setScale(0.4).setAlpha(0.8);
          this.tweens.add({ targets: ring, scale: 1.6, alpha: 0, duration: 260, onComplete: () => ring.destroy() });
        }
        break;
      }
      case "chain": {
        const from = this.units.get(event.fromId);
        const to = this.units.get(event.toId);
        if (!from || !to) break;
        const g = this.add.graphics().setDepth(DEPTH.fx);
        g.lineStyle(3, p("element-lightning"), 1);
        g.beginPath();
        const sx = from.pos.x;
        const sy = from.pos.y - UNIT_HEIGHT * from.scale * 0.5;
        const tx = to.pos.x;
        const ty = to.pos.y - UNIT_HEIGHT * to.scale * 0.5;
        g.moveTo(sx, sy);
        for (let i = 1; i < 5; i += 1) {
          const k = i / 5;
          g.lineTo(sx + (tx - sx) * k + (Math.random() - 0.5) * 16, sy + (ty - sy) * k + (Math.random() - 0.5) * 16);
        }
        g.lineTo(tx, ty);
        g.strokePath();
        this.sparks.setParticleTint(p("element-lightning"));
        this.sparks.explode(5, tx, ty);
        this.tweens.add({ targets: g, alpha: 0, duration: 140, onComplete: () => g.destroy() });
        break;
      }
      case "dodge": {
        const target = this.units.get(event.targetId);
        const v = this.visuals.get(event.targetId);
        if (!target || !v) break;
        this.floatText(target.pos.x, target.pos.y - UNIT_HEIGHT * target.scale, "miss", p("cream"), { size: 12 });
        this.tweens.chain({ targets: v.offset, tweens: [{ x: 10, duration: 70 }, { x: 0, duration: 120 }] });
        break;
      }
      case "heal": {
        const target = this.units.get(event.targetId);
        const v = this.visuals.get(event.targetId);
        if (!target || !v) break;
        this.floatText(target.pos.x, target.pos.y - UNIT_HEIGHT * 0.9, `+${event.amount}`, p("success"), { size: 15 });
        this.sfx?.play("heal");
        this.sparks.setParticleTint(p("success"));
        this.sparks.explode(6, target.pos.x, target.pos.y - 30);
        break;
      }
      case "status": {
        const target = this.units.get(event.targetId);
        const v = this.visuals.get(event.targetId);
        if (!target || !v) break;
        if (event.kind === "burn" && !v.burn) {
          v.burn = this.add.particles(0, 0, "dot", {
            follow: v.root,
            followOffset: { x: 0, y: -UNIT_HEIGHT * target.scale * 0.5 },
            speedY: { min: -60, max: -30 },
            speedX: { min: -12, max: 12 },
            scale: { start: 0.45, end: 0 },
            alpha: { start: 0.9, end: 0 },
            lifespan: 380,
            frequency: 55,
            tint: [p("element-fire"), p("gold")],
          }).setDepth(DEPTH.fx);
        }
        break;
      }
      case "death": {
        const v = this.visuals.get(event.unitId);
        const unit = this.units.get(event.unitId);
        if (!v || v.dead) break;
        v.dead = true;
        v.hpBar?.clear();
        v.burn?.stop();
        this.sfx?.play("death");
        if (event.loot && event.loot.gold > 0) this.sfx?.play("coin");
        if (unit?.side === "enemy") {
          this.dust.explode(8, unit.pos.x, unit.pos.y);
          if (event.loot && event.loot.gold > 0) this.coins.explode(unit.boss ? 8 : 3, unit.pos.x, unit.pos.y - 20);
          if (event.loot && event.loot.crystals > 0) this.crystals.explode(Math.min(8, 2 + event.loot.crystals), unit.pos.x, unit.pos.y - 24);
          if (unit.boss) this.cameras.main.shake(300, 0.008);
        }
        this.tweens.add({
          targets: v.sprite,
          alpha: 0,
          scaleY: v.baseScale * 0.15,
          scaleX: v.baseScale * 1.25,
          angle: (Math.random() - 0.5) * 40,
          duration: 380,
          ease: "Quad.in",
        });
        this.tweens.add({
          targets: v.shadow,
          alpha: 0,
          duration: 380,
          onComplete: () => {
            v.root.destroy();
            v.burn?.destroy();
            this.visuals.delete(event.unitId);
          },
        });
        break;
      }
      case "stageStart":
        if (event.stage > 1) {
          const view = this.controller.battleView();
          this.banner(fill("battle.stage", { stage: event.stage, count: view?.stageCount ?? 4 }), p("cream"));
        }
        break;
      case "stageClear":
        this.banner(copy["battle.stageClear"], p("gold"));
        this.sfx?.play("stageClear");
        break;
      case "advance": {
        // Dress the next camp before the party arrives so the run-forward lands on a drawn ledge.
        const nextStage = (this.controller.battleView()?.stage ?? 1) + 1;
        this.drawLedge(event.toCampY);
        this.dressField(event.toCampY - ARENA.campLineY, nextStage - 1);
        break;
      }
      case "levelWin":
        this.cameras.main.flash(260, 255, 243, 214);
        break;
      case "levelLose":
        this.cameras.main.fade(600, 58, 36, 16, false);
        break;
    }
  }

  override update(time: number, delta: number): void {
    const dt = delta / 1000;
    this.controller.advanceBattle(dt);
    const view = this.controller.battleView();
    if (!view) return;
    const p = this.palette;
    this.units.clear();
    for (const u of view.units) this.units.set(u.id, u);
    for (const e of this.controller.drainBattleEvents()) this.handle(e);

    // Sync visuals to sim positions with bob / squash / offset layers.
    const t = (time - this.time0) / 1000;
    for (const unit of view.units) {
      const v = this.visuals.get(unit.id) ?? (unit.alive ? this.ensureVisual(unit) : null);
      if (!v || v.dead) continue;
      const moving = unit.moving || view.phase === "advance";
      const bobSpeed = moving ? 14 : 3.2;
      const bobAmp = moving ? 3.5 : 1.4;
      const bob = Math.sin(t * bobSpeed + v.bobPhase) * bobAmp;
      v.root.x = unit.pos.x + v.offset.x;
      v.root.y = unit.pos.y + v.offset.y;
      v.root.setDepth(DEPTH.unit + (unit.pos.y - view.campY + 1000) / 1000);
      v.sprite.y = -Math.abs(bob) * (moving ? 1 : 0.5) - (moving ? 0 : bob * 0.5);
      v.sprite.setScale(v.baseScale * v.squash.x * (moving ? 1 + Math.abs(Math.sin(t * 7 + v.bobPhase)) * 0.03 : 1), v.baseScale * v.squash.y);
      v.sprite.flipX = unit.facing !== spriteFacing(unit.kind);
      v.sprite.angle = moving ? Math.sin(t * 14 + v.bobPhase) * 4 : 0;
      v.shadow.setScale(1 + Math.abs(bob) * 0.02);
      if (v.flash > 0) {
        v.flash = Math.max(0, v.flash - dt * 14);
        v.sprite.setTintFill(0xffffff);
        v.sprite.setAlpha(1);
        if (v.flash <= 0) v.sprite.clearTint();
      } else if (unit.statuses.some((s) => s.kind === "chill")) {
        v.sprite.setTint(p("element-ice"));
      } else {
        v.sprite.clearTint();
      }
      if (v.burn && !unit.statuses.some((s) => s.kind === "burn")) {
        v.burn.stop();
        const burn = v.burn;
        this.time.delayedCall(400, () => burn.destroy());
        v.burn = null;
      }
      this.drawHp(v, unit);
    }

    // Camera follows the camp line (party) — the field scrolls up on advance.
    this.cameraTargetY = view.campY - ARENA.campLineY;
    this.cameraY += (this.cameraTargetY - this.cameraY) * Math.min(1, dt * 6);
    // Camp line sits near the bottom of the viewport; the field above scrolls with the party.
    const top = this.viewTop();
    this.cameras.main.centerOn(ARENA.width / 2, top + this.viewH / 2);
    this.ground.y = top + this.viewH / 2;
    this.ground.tilePositionY = top;
    this.onFrame?.(view);
  }
}

export function createBattleRenderer(options: BattleRendererOptions): BattleRenderer {
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  // Size the canvas to the host's aspect so the arena fills it edge to edge (no letterbox).
  const hostW = options.container.clientWidth || ARENA.width;
  const hostH = options.container.clientHeight || ARENA.height;
  const viewH = Math.max(360, Math.round(hostH * (ARENA.width / hostW)));
  const scene = new Scene(options.controller, options.onFrame, options.partyLooks ?? {}, options.sfx ?? null, viewH, options.minimal ?? false);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: options.container,
    width: ARENA.width * dpr,
    height: viewH * dpr,
    transparent: false,
    antialias: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
    render: { pixelArt: false, roundPixels: false },
    fps: { target: 60, smoothStep: true },
    input: { activePointers: 1 },
    scene: [scene],
  });
  window.setTimeout(() => game.scale.refresh(), 50);
  return {
    get canvas(): HTMLCanvasElement | null {
      return game.canvas ?? null;
    },
    destroy(): void {
      game.destroy(true);
    },
    async captureFrames(count: number, everyMs: number): Promise<string[]> {
      const frames: string[] = [];
      for (let i = 0; i < count; i += 1) {
        await new Promise<void>((resolve) => {
          game.renderer.snapshot((image) => {
            if (image instanceof HTMLImageElement) frames.push(image.src);
            resolve();
          });
        });
        await new Promise((resolve) => setTimeout(resolve, everyMs));
      }
      return frames;
    },
  };
}
