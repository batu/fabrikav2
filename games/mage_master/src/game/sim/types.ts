import type { EnemyKind } from "../../../content/enemies.ts";
import type { AttackPattern, Element, WeaponRange } from "../../../content/items.ts";
import type { MageClass } from "../../../content/mages.ts";
import type { StatBlock } from "../../../content/stats.ts";

export type Side = "party" | "enemy";

export interface Vec {
  x: number;
  y: number;
}

export type StatusKind = "burn" | "chill";

export interface Status {
  kind: StatusKind;
  /** Seconds remaining. */
  remaining: number;
  /** burn: damage per tick and tick cadence. */
  perTick?: number;
  tickEvery?: number;
  nextTick?: number;
  sourceId?: string;
  /** chill: fractional slow applied to attack and move speed. */
  slow?: number;
}

export interface Unit {
  readonly id: string;
  readonly side: Side;
  /** Mage class for the party, enemy kind for enemies. */
  readonly kind: MageClass | EnemyKind;
  readonly boss: boolean;
  readonly scale: number;
  pos: Vec;
  /** Where a party unit returns to when idle (world coords). */
  home: Vec;
  hp: number;
  readonly maxHp: number;
  readonly stats: StatBlock;
  readonly reach: number;
  readonly range: WeaponRange;
  readonly pattern: AttackPattern;
  readonly element: Element | null;
  alive: boolean;
  cooldown: number;
  targetId: string | null;
  statuses: Status[];
  facing: -1 | 1;
  /** Seconds since last sustain pulse (support only). */
  sustainTimer: number;
  /** Set while the unit is committed to a melee lunge. */
  moving: boolean;
}

export interface Projectile {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly from: Vec;
  readonly element: Element | null;
  readonly pattern: AttackPattern;
  /** Attacker power snapshot at launch. */
  readonly atk: number;
  readonly critChance: number;
  readonly critDamage: number;
  readonly speed: number;
  /** Seconds remaining until impact. */
  remaining: number;
  readonly totalSeconds: number;
}

export interface Loot {
  gold: number;
  crystals: number;
}

export type HitKind = "damage" | "burn" | "chain" | "aoe";

export type BattleEvent =
  | { type: "spawn"; unitId: string }
  | { type: "attack"; unitId: string; targetId: string; range: WeaponRange; element: Element | null }
  | { type: "projectile"; projectileId: string; sourceId: string; targetId: string; element: Element | null; seconds: number }
  | {
      type: "hit";
      targetId: string;
      sourceId: string;
      amount: number;
      crit: boolean;
      blocked: boolean;
      element: Element | null;
      kind: HitKind;
    }
  | { type: "dodge"; targetId: string; sourceId: string }
  | { type: "chain"; fromId: string; toId: string }
  | { type: "heal"; targetId: string; sourceId: string; amount: number }
  | { type: "status"; targetId: string; kind: StatusKind }
  | { type: "death"; unitId: string; loot: Loot | null }
  | { type: "stageStart"; stage: number }
  | { type: "stageClear"; stage: number }
  | { type: "advance"; fromCampY: number; toCampY: number; seconds: number }
  | { type: "levelWin"; loot: Loot }
  | { type: "levelLose"; loot: Loot };

export type BattlePhase = "stage" | "advance" | "won" | "lost";

export interface BattleView {
  readonly level: number;
  readonly stage: number;
  readonly stageCount: number;
  readonly phase: BattlePhase;
  readonly elapsed: number;
  /** Current camp line y (world). Falls as the party advances. */
  readonly campY: number;
  readonly units: readonly Unit[];
  readonly projectiles: readonly Projectile[];
  readonly loot: Loot;
  /** Enemies still to spawn this stage. */
  readonly pendingSpawns: number;
}
