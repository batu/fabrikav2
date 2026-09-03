import { mulberry32 } from "@fabrikav2/kernel";
import { ARENA } from "../../../content/economy.ts";
import { LEVEL_SCALING, enemyDefinition, type EnemyKind } from "../../../content/enemies.ts";
import { AOE, ELEMENT_EFFECTS, PROJECTILE_SPEED, WEAPON_REACH, type AttackPattern, type Element, type WeaponRange } from "../../../content/items.ts";
import { MAGES, type MageClass } from "../../../content/mages.ts";
import { levelSpec, type LevelSpec, type StageSpec } from "../../../content/levels.ts";
import type { StatBlock } from "../../../content/stats.ts";
import type { BattleEvent, BattlePhase, BattleView, Loot, Projectile, Status, Unit, Vec } from "./types.ts";

/** Per-mage combat loadout the economy resolves before a battle. */
export interface PartyMember {
  readonly cls: MageClass;
  readonly stats: StatBlock;
  readonly range: WeaponRange;
  readonly pattern: AttackPattern;
  readonly element: Element;
}

export interface BattleOptions {
  readonly level: number;
  readonly party: readonly PartyMember[];
  readonly seed: number;
}

export interface Battle {
  /** Advance the simulation by `dt` seconds (fixed step recommended: 1/30). */
  step(dt: number): void;
  /** Events produced since the last drain, in order. */
  drainEvents(): BattleEvent[];
  view(): BattleView;
  /** Test/drive tool: end the battle now with the given outcome (kills the losing side). */
  forceOutcome(outcome: "won" | "lost"): void;
  readonly phase: BattlePhase;
}

export const FIXED_STEP = 1 / 30;
const ENEMY_PROJECTILE_SPEED = 420;
const RANGED_THRESHOLD = 60;
const MIN_DAMAGE = 1;
const STOP_MARGIN = 4;

interface PendingSpawn {
  kind: EnemyKind;
  at: number;
}

function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function scaledEnemyStats(kind: EnemyKind, level: number, stage: number): { stats: StatBlock; hp: number } {
  const def = enemyDefinition(kind);
  const stageMult = 1 + LEVEL_SCALING.perStage * (stage - 1);
  const hp = Math.round(def.base.hp * LEVEL_SCALING.hpPerLevel ** (level - 1) * stageMult);
  const stats: StatBlock = {
    ...def.base,
    hp,
    atk: Math.round(def.base.atk * LEVEL_SCALING.atkPerLevel ** (level - 1) * stageMult),
    def: Math.round(def.base.def * LEVEL_SCALING.defPerLevel ** (level - 1)),
  };
  return { stats, hp };
}

export function createBattle(options: BattleOptions): Battle {
  const spec: LevelSpec = levelSpec(options.level);
  const rand = mulberry32(options.seed);
  const events: BattleEvent[] = [];
  const units: Unit[] = [];
  const projectiles: Projectile[] = [];
  const loot: Loot = { gold: 0, crystals: 0 };
  let phase: BattlePhase = "stage";
  let stage = 1;
  let elapsed = 0;
  let stageClock = 0;
  let campY = ARENA.campLineY;
  let pending: PendingSpawn[] = [];
  let nextId = 1;
  let advanceRemaining = 0;
  let regroupRemaining = 0;
  let regroupHold = 0;
  let advanceFrom = campY;
  let advanceTo = campY;

  const emit = (event: BattleEvent): void => {
    events.push(event);
  };

  const spawnParty = (): void => {
    for (const member of options.party) {
      const def = MAGES.find((m) => m.id === member.cls);
      if (!def) throw new Error(`unknown mage ${member.cls}`);
      const home: Vec = { x: def.slot.x * ARENA.width, y: campY - def.slot.forward };
      const unit: Unit = {
        id: `m${nextId++}`,
        side: "party",
        kind: member.cls,
        boss: false,
        scale: 1,
        pos: { ...home },
        home,
        hp: member.stats.hp,
        maxHp: member.stats.hp,
        stats: member.stats,
        reach: WEAPON_REACH[member.range],
        range: member.range,
        pattern: member.pattern,
        element: member.element,
        alive: true,
        cooldown: 0.4 + rand() * 0.4,
        targetId: null,
        statuses: [],
        facing: 1,
        sustainTimer: 0,
        moving: false,
      };
      units.push(unit);
      emit({ type: "spawn", unitId: unit.id });
    }
  };

  const spawnEnemy = (kind: EnemyKind): void => {
    const def = enemyDefinition(kind);
    const scaled = scaledEnemyStats(kind, options.level, stage);
    const fieldTop = campY - ARENA.campLineY;
    // Spread the wave across the field; spawns in the same tick still separate via the soft repulsion.
    const x = 34 + rand() * (ARENA.width - 68);
    const y = fieldTop + ARENA.spawnTop + rand() * (ARENA.spawnBottom - ARENA.spawnTop);
    const unit: Unit = {
      id: `e${nextId++}`,
      side: "enemy",
      kind,
      boss: def.boss,
      scale: def.scale,
      pos: { x, y },
      home: { x, y },
      hp: scaled.hp,
      maxHp: scaled.hp,
      stats: scaled.stats,
      reach: def.reach,
      range: def.reach > RANGED_THRESHOLD ? "ranged" : "melee",
      pattern: "single",
      element: null,
      alive: true,
      cooldown: 0.6 + rand() * 0.5,
      targetId: null,
      statuses: [],
      facing: -1,
      sustainTimer: 0,
      moving: false,
    };
    units.push(unit);
    emit({ type: "spawn", unitId: unit.id });
  };

  const beginStage = (): void => {
    const stageSpec: StageSpec | undefined = spec.stages[stage - 1];
    if (!stageSpec) throw new Error(`level ${spec.id} has no stage ${stage}`);
    pending = stageSpec.spawns.map((s) => ({ kind: s.kind, at: s.at }));
    stageClock = 0;
    emit({ type: "stageStart", stage });
  };

  const living = (side: "party" | "enemy"): Unit[] => units.filter((u) => u.alive && u.side === side);

  const nearestFoe = (unit: Unit): Unit | null => {
    const foes = living(unit.side === "party" ? "enemy" : "party");
    let best: Unit | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const foe of foes) {
      const d = dist(unit.pos, foe.pos);
      if (d < bestD) {
        bestD = d;
        best = foe;
      }
    }
    return best;
  };

  const speedMult = (unit: Unit): number => {
    let mult = 1;
    for (const s of unit.statuses) if (s.kind === "chill" && s.slow) mult *= 1 - s.slow;
    return mult;
  };

  const dropsFor = (unit: Unit): Loot => {
    const def = enemyDefinition(unit.kind as EnemyKind);
    const stageMult = 1 + LEVEL_SCALING.perStage * (stage - 1);
    const gold = Math.max(1, Math.round(def.drops.gold * LEVEL_SCALING.goldPerLevel ** (options.level - 1) * stageMult));
    const crystals = rand() < def.drops.crystalChance ? def.drops.crystals : 0;
    return { gold, crystals };
  };

  const kill = (unit: Unit): void => {
    unit.alive = false;
    unit.hp = 0;
    unit.statuses = [];
    let drops: Loot | null = null;
    if (unit.side === "enemy") {
      drops = dropsFor(unit);
      loot.gold += drops.gold;
      loot.crystals += drops.crystals;
    }
    emit({ type: "death", unitId: unit.id, loot: drops });
  };

  const applyDamage = (
    target: Unit,
    source: Unit | null,
    raw: number,
    element: Element | null,
    kind: "damage" | "burn" | "chain" | "aoe",
    opts: { crit: boolean; allowDodge: boolean; pierce: number },
  ): number => {
    if (!target.alive) return 0;
    const sourceId = source?.id ?? "world";
    if (opts.allowDodge && rand() < target.stats.dodge) {
      emit({ type: "dodge", targetId: target.id, sourceId });
      return 0;
    }
    const blocked = opts.allowDodge && rand() < target.stats.block;
    const effectiveDef = target.stats.def * (1 - opts.pierce);
    let amount = raw * (100 / (100 + effectiveDef));
    if (blocked) amount *= 0.5;
    amount = Math.max(MIN_DAMAGE, Math.round(amount));
    target.hp = Math.max(0, target.hp - amount);
    emit({ type: "hit", targetId: target.id, sourceId, amount, crit: opts.crit, blocked, element, kind });
    if (target.hp <= 0) kill(target);
    return amount;
  };

  const applyElement = (target: Unit, source: Unit | null, atk: number, element: Element | null): void => {
    if (!element || !target.alive) return;
    if (element === "fire") {
      const fx = ELEMENT_EFFECTS.fire;
      const existing = target.statuses.find((s) => s.kind === "burn");
      const status: Status = existing ?? { kind: "burn", remaining: 0 };
      status.remaining = fx.ticks * fx.tickSec;
      status.perTick = Math.max(1, Math.round(atk * fx.atkRatioPerTick));
      status.tickEvery = fx.tickSec;
      status.nextTick = fx.tickSec;
      status.sourceId = source?.id;
      if (!existing) target.statuses.push(status);
      emit({ type: "status", targetId: target.id, kind: "burn" });
    } else if (element === "ice") {
      const fx = ELEMENT_EFFECTS.ice;
      const existing = target.statuses.find((s) => s.kind === "chill");
      if (existing) existing.remaining = fx.durationSec;
      else target.statuses.push({ kind: "chill", remaining: fx.durationSec, slow: fx.slow });
      emit({ type: "status", targetId: target.id, kind: "chill" });
    }
  };

  /** Resolve a landed attack (melee contact or projectile impact). */
  const resolveHit = (
    source: Unit | null,
    target: Unit,
    atk: number,
    critChance: number,
    critDamage: number,
    element: Element | null,
    pattern: AttackPattern,
  ): void => {
    if (!target.alive) return;
    const crit = rand() < critChance;
    const power = crit ? atk * critDamage : atk;
    const pierce = element === "arcane" ? ELEMENT_EFFECTS.arcane.defIgnored : 0;
    const primaryPos = { ...target.pos };
    applyDamage(target, source, power, element, "damage", { crit, allowDodge: true, pierce });
    applyElement(target, source, atk, element);

    if (pattern === "aoe") {
      const foes = living(target.side).filter((u) => u.id !== target.id && dist(u.pos, primaryPos) <= AOE.radius);
      for (const foe of foes) {
        applyDamage(foe, source, power * AOE.damageRatio, element, "aoe", { crit, allowDodge: true, pierce });
        applyElement(foe, source, atk, element);
      }
    }
    if (element === "lightning") {
      const fx = ELEMENT_EFFECTS.lightning;
      const others = living(target.side).filter((u) => u.id !== target.id && dist(u.pos, primaryPos) <= fx.radius);
      let arc: Unit | null = null;
      let arcD = Number.POSITIVE_INFINITY;
      for (const u of others) {
        const d = dist(u.pos, primaryPos);
        if (d < arcD) {
          arcD = d;
          arc = u;
        }
      }
      if (arc) {
        emit({ type: "chain", fromId: target.id, toId: arc.id });
        applyDamage(arc, source, power * fx.damageRatio, element, "chain", { crit: false, allowDodge: false, pierce });
      }
    }
  };

  const launchAttack = (unit: Unit, target: Unit): void => {
    unit.cooldown = 1 / Math.max(0.1, unit.stats.atkSpeed * speedMult(unit));
    unit.facing = target.pos.x >= unit.pos.x ? 1 : -1;
    emit({ type: "attack", unitId: unit.id, targetId: target.id, range: unit.range, element: unit.element });
    if (unit.range === "ranged") {
      const speed = unit.side === "party" ? PROJECTILE_SPEED : ENEMY_PROJECTILE_SPEED;
      const seconds = Math.max(0.12, dist(unit.pos, target.pos) / speed);
      const projectile: Projectile = {
        id: `p${nextId++}`,
        sourceId: unit.id,
        targetId: target.id,
        from: { ...unit.pos },
        element: unit.element,
        pattern: unit.pattern,
        atk: unit.stats.atk,
        critChance: unit.stats.critChance,
        critDamage: unit.stats.critDamage,
        speed,
        remaining: seconds,
        totalSeconds: seconds,
      };
      projectiles.push(projectile);
      emit({ type: "projectile", projectileId: projectile.id, sourceId: unit.id, targetId: target.id, element: unit.element, seconds });
      return;
    }
    resolveHit(unit, target, unit.stats.atk, unit.stats.critChance, unit.stats.critDamage, unit.element, unit.pattern);
  };

  const moveToward = (unit: Unit, to: Vec, dt: number, stopAt: number): boolean => {
    const d = dist(unit.pos, to);
    if (d <= stopAt) return true;
    const speed = unit.stats.moveSpeed * speedMult(unit);
    const stepLen = Math.min(d - stopAt, speed * dt);
    unit.pos.x += ((to.x - unit.pos.x) / d) * stepLen;
    unit.pos.y += ((to.y - unit.pos.y) / d) * stepLen;
    if (Math.abs(to.x - unit.pos.x) > 1) unit.facing = to.x > unit.pos.x ? 1 : -1;
    return dist(unit.pos, to) <= stopAt;
  };

  const tickStatuses = (unit: Unit, dt: number): void => {
    if (!unit.alive || unit.statuses.length === 0) return;
    for (const s of unit.statuses) {
      s.remaining -= dt;
      if (s.kind === "burn" && s.nextTick !== undefined && s.tickEvery !== undefined) {
        s.nextTick -= dt;
        if (s.nextTick <= 0 && unit.alive) {
          s.nextTick += s.tickEvery;
          const source = s.sourceId ? (units.find((u) => u.id === s.sourceId) ?? null) : null;
          applyDamage(unit, source, s.perTick ?? 1, "fire", "burn", { crit: false, allowDodge: false, pierce: 1 });
        }
      }
    }
    unit.statuses = unit.statuses.filter((s) => s.remaining > 0);
  };

  const tickUnit = (unit: Unit, dt: number): void => {
    if (!unit.alive) return;
    tickStatuses(unit, dt);
    if (!unit.alive) return;
    if (unit.stats.hpRegen > 0 && unit.hp < unit.maxHp) {
      unit.hp = Math.min(unit.maxHp, unit.hp + unit.stats.hpRegen * dt);
    }
    // Support sustain pulse.
    const mageDef = unit.side === "party" ? MAGES.find((m) => m.id === unit.kind) : undefined;
    if (mageDef?.sustain) {
      unit.sustainTimer += dt;
      if (unit.sustainTimer >= mageDef.sustain.everySec) {
        unit.sustainTimer = 0;
        const allies = living("party").filter((u) => u.hp < u.maxHp);
        let lowest: Unit | null = null;
        for (const a of allies) if (!lowest || a.hp / a.maxHp < lowest.hp / lowest.maxHp) lowest = a;
        if (lowest) {
          const amount = Math.round(unit.stats.atk * mageDef.sustain.atkRatio);
          lowest.hp = Math.min(lowest.maxHp, lowest.hp + amount);
          emit({ type: "heal", targetId: lowest.id, sourceId: unit.id, amount });
        }
      }
    }
    unit.cooldown -= dt;
    const target = unit.targetId ? units.find((u) => u.id === unit.targetId && u.alive) : undefined;
    const foe = target ?? nearestFoe(unit);
    unit.targetId = foe?.id ?? null;
    if (!foe) {
      // Idle: party units drift home; enemies hold.
      if (unit.side === "party") unit.moving = !moveToward(unit, unit.home, dt, 1);
      return;
    }
    const inReach = dist(unit.pos, foe.pos) <= unit.reach;
    if (!inReach) {
      if (unit.range === "melee" || unit.side === "enemy") {
        unit.moving = true;
        moveToward(unit, foe.pos, dt, Math.max(2, unit.reach - STOP_MARGIN));
      } else {
        unit.moving = false;
      }
      return;
    }
    unit.moving = false;
    unit.facing = foe.pos.x >= unit.pos.x ? 1 : -1;
    if (unit.cooldown <= 0) launchAttack(unit, foe);
  };

  const tickProjectiles = (dt: number): void => {
    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
      const p = projectiles[i];
      if (!p) continue;
      p.remaining -= dt;
      if (p.remaining > 0) continue;
      projectiles.splice(i, 1);
      const source = units.find((u) => u.id === p.sourceId) ?? null;
      const target = units.find((u) => u.id === p.targetId);
      if (!target || !target.alive) continue;
      resolveHit(source, target, p.atk, p.critChance, p.critDamage, p.element, p.pattern);
    }
  };

  /** Push overlapping units apart (both sides), keeping melee piles legible. */
  const separate = (dt: number): void => {
    const alive = units.filter((u) => u.alive);
    for (let i = 0; i < alive.length; i += 1) {
      const a = alive[i];
      if (!a) continue;
      for (let j = i + 1; j < alive.length; j += 1) {
        const b = alive[j];
        if (!b) continue;
        let minDist = ARENA.separation * ((a.scale + b.scale) / 2);
        // Opponents may close to attack range: never hold a melee unit outside its own reach.
        if (a.side !== b.side) minDist = Math.min(minDist, Math.min(a.reach, b.reach) - STOP_MARGIN);
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const d = Math.hypot(dx, dy);
        if (d >= minDist || d === 0) continue;
        const push = ((minDist - d) / minDist) * ARENA.separationStrength * dt * 60;
        const nx = dx / d;
        const ny = dy / d;
        const wa = a.boss ? 0.2 : 1;
        const wb = b.boss ? 0.2 : 1;
        a.pos.x -= nx * push * wa;
        a.pos.y -= ny * push * wa * 0.6;
        b.pos.x += nx * push * wb;
        b.pos.y += ny * push * wb * 0.6;
        a.pos.x = Math.max(16, Math.min(ARENA.width - 16, a.pos.x));
        b.pos.x = Math.max(16, Math.min(ARENA.width - 16, b.pos.x));
      }
    }
  };

  const tickSpawns = (): void => {
    if (pending.length === 0) return;
    const due = pending.filter((s) => s.at <= stageClock);
    if (due.length === 0) return;
    pending = pending.filter((s) => s.at > stageClock);
    for (const s of due) spawnEnemy(s.kind);
  };

  const checkOutcome = (): void => {
    if (living("party").length === 0) {
      phase = "lost";
      emit({ type: "levelLose", loot: { ...loot } });
      return;
    }
    if (pending.length === 0 && living("enemy").length === 0 && projectiles.length === 0) {
      emit({ type: "stageClear", stage });
      if (stage >= spec.stages.length) {
        loot.gold += spec.clearBonus.gold;
        loot.crystals += spec.clearBonus.crystals;
        phase = "won";
        emit({ type: "levelWin", loot: { ...loot } });
        return;
      }
      phase = "regroup";
      regroupRemaining = ARENA.regroupMaxSeconds;
      regroupHold = ARENA.regroupHoldSeconds;
      for (const u of living("party")) {
        u.statuses = [];
        u.targetId = null;
      }
    }
  };

  /** Walk the party back into formation, hold a beat, then start the run-forward. */
  const tickRegroup = (dt: number): void => {
    regroupRemaining -= dt;
    let settled = true;
    for (const u of living("party")) {
      const arrived = moveToward(u, u.home, dt, 1);
      u.moving = !arrived;
      if (!arrived) settled = false;
      if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.15 * dt);
    }
    if (settled) regroupHold -= dt;
    if ((settled && regroupHold <= 0) || regroupRemaining <= 0) beginAdvance();
  };

  const beginAdvance = (): void => {
    phase = "advance";
    advanceFrom = campY;
    advanceTo = campY - ARENA.advanceDistance;
    advanceRemaining = ARENA.advanceSeconds;
    for (const u of living("party")) {
      u.home = { x: u.home.x, y: u.home.y - ARENA.advanceDistance };
      u.facing = 1;
    }
    emit({ type: "advance", fromCampY: advanceFrom, toCampY: advanceTo, seconds: ARENA.advanceSeconds });
  };

  const tickAdvance = (dt: number): void => {
    advanceRemaining -= dt;
    const t = 1 - Math.max(0, advanceRemaining) / ARENA.advanceSeconds;
    const eased = t * t * (3 - 2 * t);
    campY = advanceFrom + (advanceTo - advanceFrom) * eased;
    for (const u of living("party")) {
      u.pos.y = u.home.y + ARENA.advanceDistance * (1 - eased);
      u.pos.x += (u.home.x - u.pos.x) * Math.min(1, dt * 4);
      u.facing = 1;
      u.moving = true;
      if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.15 * dt);
    }
    if (advanceRemaining <= 0) {
      campY = advanceTo;
      for (const u of living("party")) {
        u.pos = { ...u.home };
        u.moving = false;
        u.cooldown = Math.max(u.cooldown, 0.3);
      }
      stage += 1;
      phase = "stage";
      beginStage();
    }
  };

  spawnParty();
  beginStage();

  return {
    get phase(): BattlePhase {
      return phase;
    },
    step(dt: number): void {
      if (phase === "won" || phase === "lost") return;
      elapsed += dt;
      if (phase === "regroup") {
        tickRegroup(dt);
        return;
      }
      if (phase === "advance") {
        tickAdvance(dt);
        return;
      }
      stageClock += dt;
      tickSpawns();
      for (const unit of units) tickUnit(unit, dt);
      separate(dt);
      tickProjectiles(dt);
      checkOutcome();
    },
    forceOutcome(outcome: "won" | "lost"): void {
      if (phase === "won" || phase === "lost") return;
      const losers = living(outcome === "won" ? "enemy" : "party");
      for (const unit of losers) kill(unit);
      pending = [];
      projectiles.length = 0;
      if (outcome === "won") {
        loot.gold += spec.clearBonus.gold;
        loot.crystals += spec.clearBonus.crystals;
        phase = "won";
        emit({ type: "levelWin", loot: { ...loot } });
      } else {
        phase = "lost";
        emit({ type: "levelLose", loot: { ...loot } });
      }
    },
    drainEvents(): BattleEvent[] {
      return events.splice(0, events.length);
    },
    view(): BattleView {
      return {
        level: options.level,
        stage,
        stageCount: spec.stages.length,
        phase,
        elapsed,
        campY,
        units,
        projectiles,
        loot,
        pendingSpawns: pending.length,
      };
    },
  };
}

/** Run a battle headless to completion (or `maxSeconds`). Returns the final phase. */
export function simulateBattle(battle: Battle, maxSeconds = 600): BattlePhase {
  let t = 0;
  while (t < maxSeconds && battle.phase !== "won" && battle.phase !== "lost") {
    battle.step(FIXED_STEP);
    battle.drainEvents();
    t += FIXED_STEP;
  }
  return battle.phase;
}
