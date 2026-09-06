import { mulberry32 } from '@fabrikav2/kernel';
import { Progression, RunStats } from '../core/progression';
import { WAVES, WEAPONS, type Card } from './catalog';

export const ENEMY_CAP = 8192;
export const BULLET_CAP = 4096;
const GRID_WIDTH = 24;
const CELL = 5;
const BOUNDS = 60;
const TAU = Math.PI * 2;
const ENEMY_SIZE = [1.05, .8, 1.65, 3.4] as const;
const ENEMY_HEALTH = [11, 7, 45, 450] as const;
const ENEMY_SPEED = [4.8, 7.2, 3.5, 2.3] as const;
export type Phase = 'home' | 'combat' | 'cards' | 'ready' | 'defeat' | 'victory';
export class Pool {
  count = 0;
  x: Float32Array; y: Float32Array; hp: Float32Array; size: Float32Array;
  vx: Float32Array; vy: Float32Array; life: Float32Array; kind: Int32Array;
  damage: Float32Array; mark: Int32Array; aux: Float32Array;
  constructor(readonly capacity: number) {
    this.x = new Float32Array(capacity); this.y = new Float32Array(capacity);
    this.hp = new Float32Array(capacity); this.size = new Float32Array(capacity);
    this.vx = new Float32Array(capacity); this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity); this.kind = new Int32Array(capacity);
    this.damage = new Float32Array(capacity); this.mark = new Int32Array(capacity); this.aux = new Float32Array(capacity);
  }
  add(): number { return this.count < this.capacity ? this.count++ : -1; }
  remove(i: number): void {
    const last = --this.count;
    this.x[i] = this.x[last]; this.y[i] = this.y[last]; this.hp[i] = this.hp[last]; this.size[i] = this.size[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.life[i] = this.life[last]; this.kind[i] = this.kind[last];
    this.damage[i] = this.damage[last]; this.mark[i] = this.mark[last]; this.aux[i] = this.aux[last];
  }
}
export class SpatialGrid {
  head = new Int32Array(GRID_WIDTH * GRID_WIDTH).fill(-1);
  next = new Int32Array(ENEMY_CAP);
  cell(n: number): number { return Math.max(0, Math.min(GRID_WIDTH - 1, Math.floor((n + BOUNDS) / CELL))); }
  rebuild(p: Pool): void {
    this.head.fill(-1);
    for (let i = 0; i < p.count; i++) {
      if (p.hp[i] <= 0) continue;
      const cell = this.cell(p.y[i]) * GRID_WIDTH + this.cell(p.x[i]);
      this.next[i] = this.head[cell]; this.head[cell] = i;
    }
  }
  nearest(p: Pool, x: number, y: number, radius: number, excludeMark = -1): number {
    if (p.count === 0) return -1;
    let best = -1, distance = radius * radius;
    for (let cy = this.cell(y - radius); cy <= this.cell(y + radius); cy++) {
      for (let cx = this.cell(x - radius); cx <= this.cell(x + radius); cx++) {
        for (let i = this.head[cy * GRID_WIDTH + cx]; i !== -1; i = this.next[i]) {
          if (p.hp[i] <= 0 || p.mark[i] === excludeMark) continue;
          const dx = p.x[i] - x, dy = p.y[i] - y, d = dx * dx + dy * dy;
          if (d < distance) { distance = d; best = i; }
        }
      }
    }
    return best;
  }
}
export class Simulation {
  phase: Phase = 'home'; paused = false; level = 1; wave = 1;
  enemies = new Pool(ENEMY_CAP); bullets = new Pool(BULLET_CAP); effects = new Pool(768);
  grid = new SpatialGrid(); stats: RunStats;
  hp = 100; kills = 0; xp = 0; rank = 1; pendingPicks = 0; reward = 0; earned = 0;
  spawned = 0; spawnTotal = 0; time = 0; spawnClock = 0; tick = 0;
  aim = -Math.PI / 2; shots = 0; peakEnemies = 0; droppedSpawns = 0;
  cards: Card[] = []; random: () => number;
  towerHp = new Float32Array(8); towerAngle = new Float32Array(8); cooldown = new Float32Array(9);
  readonly towerX = Float32Array.from({ length: 8 }, (_, i) => Math.cos(i * TAU / 8 - Math.PI / 2) * 12);
  readonly towerY = Float32Array.from({ length: 8 }, (_, i) => Math.sin(i * TAU / 8 - Math.PI / 2) * 12);
  stress = false;
  private enemyIdentity = 0;
  constructor(readonly progression: Progression, seed = Date.now()) {
    this.stats = new RunStats(progression.save); this.random = mulberry32(seed); this.repair();
  }
  get xpNeeded(): number { return 40 + this.rank * 25; }
  get maxHp(): number { return Math.round(100 * (1 + this.stats.bonus('health'))); }
  start(level = 1, recordAttempt = true): boolean {
    if (!Number.isInteger(level) || level < 1 || level > this.progression.save.unlockedLevel) return false;
    this.level = level; this.wave = 1; this.hp = 100; this.kills = 0; this.xp = 0; this.rank = 1; this.pendingPicks = 0; this.earned = 0;
    this.stats = new RunStats(structuredClone(this.progression.save)); this.cards = []; this.stress = false;
    this.shots = 0; this.peakEnemies = 0; this.droppedSpawns = 0; this.aim = -Math.PI / 2;
    if (recordAttempt) { this.progression.save.attempts++; this.progression.persist(); }
    this.beginWave(); return true;
  }
  beginWave(): void {
    this.enemies.count = 0; this.bullets.count = 0; this.effects.count = 0;
    this.grid.rebuild(this.enemies);
    this.spawned = 0; this.time = 0; this.spawnClock = 0; this.cooldown.fill(0);
    this.spawnTotal = Math.round(130 * Math.pow(1.28, this.wave - 1) * (1 + (this.level - 1) * .35));
    this.repair(); this.paused = false; this.phase = 'combat';
  }
  repair(): void { this.towerHp.fill(90); }
  nextWave(): boolean {
    if (this.phase !== 'ready') return false;
    this.wave++; this.beginWave(); return true;
  }
  choose(index: number): boolean {
    if (this.phase !== 'cards' || !Number.isInteger(index) || !this.cards[index]) return false;
    const oldMaxHp = this.maxHp;
    this.stats.cards.push(this.cards[index]); this.pendingPicks--;
    this.hp += this.maxHp - oldMaxHp;
    if (this.pendingPicks > 0) this.cards = this.stats.draft(this.random);
    else { this.cards = []; this.phase = this.wave === WAVES ? 'victory' : 'ready'; }
    return true;
  }
  private completeWave(): void {
    this.reward = 12 + this.wave * 3 + (this.wave === WAVES ? 50 : 0);
    this.earned += this.reward; this.progression.bank(this.level, this.wave, this.reward);
    this.hp = Math.min(this.maxHp, this.hp + 15); this.repair(); this.bullets.count = 0; this.effects.count = 0;
    if (this.pendingPicks > 0) { this.cards = this.stats.draft(this.random); this.phase = 'cards'; }
    else this.phase = this.wave === WAVES ? 'victory' : 'ready';
  }
  spawnEnemy(angle?: number): void {
    const p = this.enemies, i = p.add();
    if (i < 0) { this.droppedSpawns++; return; }
    const a = angle ?? (-Math.PI / 2 + (this.wave - 1) * Math.PI / 2 + (this.random() - .5) * (this.wave > 4 ? 3.5 : 2.2));
    const radius = 52 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    p.x[i] = Math.cos(a) * radius; p.y[i] = Math.sin(a) * radius;
    const roll = this.random();
    const kind = this.wave % 5 === 0 && this.spawned === 0 ? 3 : roll < .12 && this.wave > 2 ? 2 : roll < .35 ? 1 : 0;
    p.kind[i] = kind; p.size[i] = ENEMY_SIZE[kind];
    p.hp[i] = ENEMY_HEALTH[kind] * Math.pow(1.28, this.wave - 1) * (1 + (this.level - 1) * .35);
    p.vx[i] = ENEMY_SPEED[kind] * (.85 + this.random() * .3);
    p.life[i] = 0; p.mark[i] = 0; p.aux[i] = ++this.enemyIdentity;
    this.peakEnemies = Math.max(this.peakEnemies, p.count);
  }
  private hit(i: number, damage: number): void {
    const p = this.enemies;
    if (p.hp[i] <= 0) return;
    p.hp[i] -= damage; p.life[i] = .09;
    if (p.hp[i] > 0) return;
    this.kills++; this.xp += (p.kind[i] === 3 ? 20 : p.kind[i] === 2 ? 3 : 1) * (1 + this.stats.bonus('xp'));
    while (this.xp >= this.xpNeeded) { this.xp -= this.xpNeeded; this.rank++; this.pendingPicks++; }
    if (this.effects.count < 500) this.effect(p.x[i], p.y[i], 0, 0, p.size[i] * 1.8, 0, .18);
  }
  effect(x: number, y: number, x2: number, y2: number, size: number, kind: number, life: number): void {
    const p = this.effects, i = p.add(); if (i < 0) return;
    p.x[i] = x; p.y[i] = y; p.vx[i] = x2; p.vy[i] = y2; p.size[i] = size;
    p.kind[i] = kind; p.life[i] = life; p.aux[i] = life;
  }
  private splash(x: number, y: number, radius: number, damage: number): void {
    const p = this.enemies, g = this.grid;
    for (let cy = g.cell(y - radius); cy <= g.cell(y + radius); cy++) for (let cx = g.cell(x - radius); cx <= g.cell(x + radius); cx++) {
      for (let i = g.head[cy * GRID_WIDTH + cx]; i !== -1; i = g.next[i]) {
        const dx = p.x[i] - x, dy = p.y[i] - y;
        if (dx * dx + dy * dy < radius * radius) this.hit(i, damage);
      }
    }
  }
  private fire(weapon: number, x: number, y: number, angle: number): void {
    const w = WEAPONS[weapon], area = 1 + this.stats.bonus('area', weapon);
    const damage = w.damage * (1 + this.stats.bonus('damage', weapon)) * (this.random() < .05 + this.stats.bonus('crit', weapon) ? 2 : 1);
    const dx = Math.cos(angle), dy = Math.sin(angle); this.shots++;
    if (weapon === 1) {
      const range = w.range * Math.sqrt(area), p = this.enemies, g = this.grid;
      for (let cy = g.cell(y - range); cy <= g.cell(y + range); cy++) for (let cx = g.cell(x - range); cx <= g.cell(x + range); cx++) {
        for (let i = g.head[cy * GRID_WIDTH + cx]; i !== -1; i = g.next[i]) {
          const ex = p.x[i] - x, ey = p.y[i] - y, d = Math.sqrt(ex * ex + ey * ey);
          if (d < range && (ex * dx + ey * dy) / Math.max(.001, d) > Math.cos(.40 * Math.sqrt(area))) this.hit(i, damage);
        }
      }
      this.effect(x, y, x + dx * range, y + dy * range, range * .34, 1, .17); return;
    }
    if (weapon === 2) {
      let tx = x + dx * 22, ty = y + dy * 22;
      let target = this.grid.nearest(this.enemies, tx, ty, 20);
      let px = x, py = y;
      for (let jump = 0; jump < 6 && target >= 0; jump++) {
        tx = this.enemies.x[target]; ty = this.enemies.y[target];
        this.enemies.mark[target] = this.shots;
        this.hit(target, damage * Math.pow(.90, jump)); this.effect(px, py, tx, ty, .45, 2, .15);
        px = tx; py = ty; target = this.grid.nearest(this.enemies, tx, ty, 10 * Math.sqrt(area), this.shots);
      }
      return;
    }
    const p = this.bullets, i = p.add(); if (i < 0) return;
    p.x[i] = x + dx * 2.5; p.y[i] = y + dy * 2.5; p.vx[i] = dx * (weapon === 3 ? 38 : 80); p.vy[i] = dy * (weapon === 3 ? 38 : 80);
    p.kind[i] = weapon; p.size[i] = weapon === 3 ? 1.3 : .5; p.damage[i] = damage;
    p.life[i] = weapon === 3 ? .95 : 1.4; p.hp[i] = weapon === 3 ? 1 : 3;
    p.aux[i] = area; p.mark[i] = -1;
  }
  update(dt: number): void {
    if (this.phase !== 'combat' || this.paused) return;
    this.time += dt; this.tick++;
    const e = this.enemies;
    if (!this.stress) {
      this.spawnClock += dt;
      const interval = (16 + this.wave * .7) / this.spawnTotal;
      while (this.spawnClock >= interval && this.spawned < this.spawnTotal) {
        this.spawnClock -= interval; this.spawnEnemy(); this.spawned++;
      }
    }
    // Compact dead entities only before rebuilding the index; all weapon queries
    // see stable indices for the rest of this tick.
    for (let i = e.count - 1; i >= 0; i--) if (e.hp[i] <= 0) e.remove(i);
    for (let i = 0; i < e.count; i++) {
      e.life[i] = Math.max(0, e.life[i] - dt);
      let tx = 0, ty = 0, target = -1, best = e.x[i] * e.x[i] + e.y[i] * e.y[i];
      for (let t = 0; t < 8; t++) {
        if (this.stats.meta.layout[t] === -2 || this.towerHp[t] <= 0) continue;
        const dx = this.towerX[t] - e.x[i], dy = this.towerY[t] - e.y[i], distance = dx * dx + dy * dy;
        if (distance < best) { best = distance; tx = this.towerX[t]; ty = this.towerY[t]; target = t; }
      }
      const dx = tx - e.x[i], dy = ty - e.y[i], distance = Math.sqrt(best);
      if (distance > (target < 0 ? 3.4 : 3) + e.size[i]) {
        e.x[i] += dx / distance * e.vx[i] * dt; e.y[i] += dy / distance * e.vx[i] * dt;
      } else if (this.stress) {
        // Recycle to the perimeter so sustained tests keep moving a full field,
        // rather than measuring thousands of stationary, overlapping attackers.
        const angle = this.random() * TAU, radius = 49 / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
        e.x[i] = Math.cos(angle) * radius; e.y[i] = Math.sin(angle) * radius;
      } else {
        const damage = (e.kind[i] === 3 ? 8 : e.kind[i] === 2 ? 1.2 : .45) * dt;
        if (target < 0) this.hp -= damage; else this.towerHp[target] = Math.max(0, this.towerHp[target] - damage * 2.5);
      }
    }
    this.grid.rebuild(e);
    for (let slot = 0; slot < 9; slot++) {
      const weapon = slot === 8 ? this.stats.meta.playerWeapon : this.stats.meta.layout[slot];
      if (weapon < 0 || (slot < 8 && this.towerHp[slot] <= 0)) continue;
      this.cooldown[slot] -= dt; if (this.cooldown[slot] > 0) continue;
      const x = slot === 8 ? 0 : this.towerX[slot], y = slot === 8 ? 0 : this.towerY[slot];
      let angle = this.aim;
      if (slot < 8) {
        const target = this.grid.nearest(e, x, y, WEAPONS[weapon].range);
        if (target < 0) continue;
        angle = Math.atan2(e.y[target] - y, e.x[target] - x); this.towerAngle[slot] = angle;
      }
      const rate = WEAPONS[weapon].rate * (1 + this.stats.bonus('rate', weapon)) * (slot < 8 && this.stats.meta.character === 2 ? 1.35 : 1);
      this.cooldown[slot] = 1 / Math.min(60, rate); this.fire(weapon, x, y, angle);
    }
    const p = this.bullets, g = this.grid;
    for (let b = p.count - 1; b >= 0; b--) {
      const ox = p.x[b], oy = p.y[b], nx = ox + p.vx[b] * dt, ny = oy + p.vy[b] * dt;
      p.x[b] = nx; p.y[b] = ny; p.life[b] -= dt;
      let impact = false;
      // Swept segment vs circle prevents fast rounds tunnelling through enemies.
      const sx = nx - ox, sy = ny - oy, length2 = sx * sx + sy * sy;
      for (let cy = g.cell(Math.min(oy, ny) - 5); cy <= g.cell(Math.max(oy, ny) + 5) && !impact; cy++) {
        for (let cx = g.cell(Math.min(ox, nx) - 5); cx <= g.cell(Math.max(ox, nx) + 5) && !impact; cx++) {
          for (let i = g.head[cy * GRID_WIDTH + cx]; i !== -1; i = g.next[i]) {
            if (e.hp[i] <= 0 || e.aux[i] === p.mark[b]) continue;
            const t = Math.max(0, Math.min(1, ((e.x[i] - ox) * sx + (e.y[i] - oy) * sy) / length2));
            const ex = e.x[i] - ox - sx * t, ey = e.y[i] - oy - sy * t, radius = e.size[i] + p.size[b];
            if (ex * ex + ey * ey > radius * radius) continue;
            if (p.kind[b] === 3) { impact = true; break; }
            this.hit(i, p.damage[b]); p.mark[b] = e.aux[i]; p.hp[b]--; if (p.hp[b] <= 0) { impact = true; break; }
          }
        }
      }
      if (p.kind[b] === 3 && (impact || p.life[b] <= 0)) {
        const radius = 9 * Math.sqrt(p.aux[b]); this.splash(nx, ny, radius, p.damage[b]);
        this.effect(nx, ny, 0, 0, radius, 3, .35);
      }
      if (impact || p.life[b] <= 0 || Math.abs(nx) > 65 || Math.abs(ny) > 65) p.remove(b);
    }
    for (let i = this.effects.count - 1; i >= 0; i--) { this.effects.life[i] -= dt; if (this.effects.life[i] <= 0) this.effects.remove(i); }
    if (this.hp <= 0) { this.hp = 0; this.phase = 'defeat'; }
    else if (!this.stress && this.spawned >= this.spawnTotal && e.count === 0) this.completeWave();
  }
  stressScene(count: number): void {
    this.start(1, false); this.stress = true; this.enemies.count = 0; this.spawned = this.spawnTotal;
    this.stats.meta.playerWeapon = 1;
    this.stats.meta.layout = [0, -1, 2, -2, 3, -2, -2, -1];
    for (let i = 0; i < Math.min(ENEMY_CAP, Math.max(0, Math.floor(count))); i++) {
      this.spawnEnemy(this.random() * TAU); this.enemies.x[i] *= this.random(); this.enemies.y[i] *= this.random();
      this.enemies.hp[i] = 1e8;
    }
    this.grid.rebuild(this.enemies);
  }
  snapshot() {
    const threat = this.grid.nearest(this.enemies, 0, 0, 85);
    return { phase: this.phase, paused: this.paused, level: this.level, wave: this.wave, hp: this.hp, maxHp: this.maxHp,
      enemies: this.enemies.count, bullets: this.bullets.count, effects: this.effects.count, shots: this.shots,
      peakEnemies: this.peakEnemies, kills: this.kills, xp: this.xp, rank: this.rank, pendingPicks: this.pendingPicks,
      aim: this.aim, threatAngle: threat < 0 ? this.aim : Math.atan2(this.enemies.y[threat], this.enemies.x[threat]), cards: this.stats.cards, offers: this.cards, salvage: this.progression.save.salvage,
      earned: this.earned, towerHp: Array.from(this.towerHp), droppedSpawns: this.droppedSpawns, stress: this.stress };
  }
}
