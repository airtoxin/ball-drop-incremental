import type { SaveData } from "./state";

// ---------- Tunable step/max constants ----------
// Mechanics constants — shared between game code and simulator.

export const RESTITUTION_STEP = 0.05;

export const AUTO_DROP_BASE_INTERVAL = 10000;
export const AUTO_DROP_MIN_INTERVAL = 1000;
export const AUTO_DROP_STEP = 1000;

export const MULTIPLIER_BASE = 1;
export const MULTIPLIER_STEP = 0.05;
export const MULTIPLIER_MAX = 2;

export const CRITICAL_CHANCE_PER_LEVEL = 0.05;
export const CRITICAL_MAX_CHANCE = 0.5;
export const CRITICAL_BONUS = 5;

export const TRAIT_CHANCE_PER_LEVEL = 0.1;
export const TRAIT_MAX_LEVEL = 10;

export const EXPAND_ROWS_MAX = 2;
export const EXPAND_COLS_MAX = 6;

export const SPLIT_SPAWN_CHANCE = 0.2;
export const PREMIUM_START_VALUE = 3;
export const DEFAULT_START_VALUE = 1;

// Derived max levels.
export const AUTO_DROP_MAX_LEVEL =
  (AUTO_DROP_BASE_INTERVAL - AUTO_DROP_MIN_INTERVAL) / AUTO_DROP_STEP + 1;
export const MULTIPLIER_MAX_LEVEL = Math.round(
  (MULTIPLIER_MAX - MULTIPLIER_BASE) / MULTIPLIER_STEP,
);
export const CRITICAL_MAX_LEVEL = Math.round(CRITICAL_MAX_CHANCE / CRITICAL_CHANCE_PER_LEVEL);

// ---------- Upgrade registry ----------

export type UpgradeId =
  | "maxBalls"
  | "restitution"
  | "autoDrop"
  | "bounceMultiplier"
  | "critical"
  | "multiDrop"
  | "expandRows"
  | "expandCols"
  | "bumpers"
  | "zigzag"
  | "traitsUnlock"
  | "trait:big"
  | "trait:premium"
  | "trait:critical"
  | "trait:life"
  | "trait:split";

export interface UpgradeDef {
  baseCost: number;
  costGrowth: number;
  maxLevel: number;
}

// Single source of truth for pricing. costGrowth=1 preserves current flat-cost
// behavior; tune growth rates here and the simulator will reflect the change.
export const UPGRADE_DEFS: Record<UpgradeId, UpgradeDef> = {
  maxBalls: { baseCost: 100, costGrowth: 1, maxLevel: Infinity },
  restitution: { baseCost: 200, costGrowth: 1, maxLevel: Infinity },
  autoDrop: { baseCost: 300, costGrowth: 1, maxLevel: AUTO_DROP_MAX_LEVEL },
  bounceMultiplier: { baseCost: 500, costGrowth: 1, maxLevel: MULTIPLIER_MAX_LEVEL },
  critical: { baseCost: 400, costGrowth: 1, maxLevel: CRITICAL_MAX_LEVEL },
  multiDrop: { baseCost: 400, costGrowth: 1, maxLevel: Infinity },
  expandRows: { baseCost: 300, costGrowth: 1, maxLevel: EXPAND_ROWS_MAX },
  expandCols: { baseCost: 300, costGrowth: 1, maxLevel: EXPAND_COLS_MAX },
  bumpers: { baseCost: 600, costGrowth: 1, maxLevel: 1 },
  zigzag: { baseCost: 800, costGrowth: 1, maxLevel: 1 },
  traitsUnlock: { baseCost: 1000, costGrowth: 1, maxLevel: 1 },
  "trait:big": { baseCost: 500, costGrowth: 1, maxLevel: TRAIT_MAX_LEVEL },
  "trait:premium": { baseCost: 500, costGrowth: 1, maxLevel: TRAIT_MAX_LEVEL },
  "trait:critical": { baseCost: 500, costGrowth: 1, maxLevel: TRAIT_MAX_LEVEL },
  "trait:life": { baseCost: 500, costGrowth: 1, maxLevel: TRAIT_MAX_LEVEL },
  "trait:split": { baseCost: 500, costGrowth: 1, maxLevel: TRAIT_MAX_LEVEL },
};

export const ALL_UPGRADE_IDS: UpgradeId[] = Object.keys(UPGRADE_DEFS) as UpgradeId[];

export function costOf(id: UpgradeId, level: number): number {
  const def = UPGRADE_DEFS[id];
  return Math.round(def.baseCost * Math.pow(def.costGrowth, level));
}

export function isMaxed(id: UpgradeId, level: number): boolean {
  return level >= UPGRADE_DEFS[id].maxLevel;
}

export function getLevel(state: Readonly<SaveData>, id: UpgradeId): number {
  switch (id) {
    case "maxBalls":
      return state.upgrades.maxBalls;
    case "restitution":
      return state.upgrades.restitution;
    case "autoDrop":
      return state.upgrades.autoDrop;
    case "bounceMultiplier":
      return state.upgrades.bounceMultiplier;
    case "critical":
      return state.upgrades.critical;
    case "multiDrop":
      return state.upgrades.multiDrop;
    case "expandRows":
      return state.expandRows;
    case "expandCols":
      return state.expandCols;
    case "bumpers":
      return state.hasBumpers ? 1 : 0;
    case "zigzag":
      return state.hasZigzag ? 1 : 0;
    case "traitsUnlock":
      return state.hasSpecialBalls ? 1 : 0;
    case "trait:big":
      return state.specialBalls.big;
    case "trait:premium":
      return state.specialBalls.premium;
    case "trait:critical":
      return state.specialBalls.critical;
    case "trait:life":
      return state.specialBalls.life;
    case "trait:split":
      return state.specialBalls.split;
  }
}

// ---------- Purchase application (pure) ----------
// Mutates a SaveData copy. Used by the simulator to advance state deterministically.
// Game code does not call this directly — side effects (timers, obstacle rebuild)
// live in world.ts, but they derive their numeric effects from the same constants.

export function applyPurchase(state: SaveData, id: UpgradeId): void {
  switch (id) {
    case "maxBalls":
      state.maxBalls += 1;
      state.upgrades.maxBalls += 1;
      return;
    case "restitution":
      state.ballRestitution = Math.round((state.ballRestitution + RESTITUTION_STEP) * 100) / 100;
      state.upgrades.restitution += 1;
      return;
    case "autoDrop": {
      const newLevel = state.upgrades.autoDrop + 1;
      state.autoDropInterval = Math.max(
        AUTO_DROP_MIN_INTERVAL,
        AUTO_DROP_BASE_INTERVAL - (newLevel - 1) * AUTO_DROP_STEP,
      );
      state.upgrades.autoDrop = newLevel;
      return;
    }
    case "bounceMultiplier":
      state.bounceMultiplier = Math.min(
        MULTIPLIER_MAX,
        Math.round((state.bounceMultiplier + MULTIPLIER_STEP) * 100) / 100,
      );
      state.upgrades.bounceMultiplier += 1;
      return;
    case "critical":
      state.criticalChance = Math.min(
        CRITICAL_MAX_CHANCE,
        Math.round((state.criticalChance + CRITICAL_CHANCE_PER_LEVEL) * 100) / 100,
      );
      state.upgrades.critical += 1;
      return;
    case "multiDrop":
      state.multiDrop += 1;
      state.upgrades.multiDrop += 1;
      return;
    case "expandRows":
      state.expandRows += 1;
      return;
    case "expandCols":
      state.expandCols += 1;
      return;
    case "bumpers":
      state.hasBumpers = true;
      return;
    case "zigzag":
      state.hasZigzag = true;
      return;
    case "traitsUnlock":
      state.hasSpecialBalls = true;
      return;
    case "trait:big":
      state.specialBalls.big += 1;
      return;
    case "trait:premium":
      state.specialBalls.premium += 1;
      return;
    case "trait:critical":
      state.specialBalls.critical += 1;
      return;
    case "trait:life":
      state.specialBalls.life += 1;
      return;
    case "trait:split":
      state.specialBalls.split += 1;
      return;
  }
}

// ---------- Income model ----------
// Analytic approximation of expected score per second. Used for simulator tuning,
// not for live gameplay. Deliberately closed-form so tweaking costs + running the
// simulator takes <1s.

export interface IncomeParams {
  // Average wall/obstacle hits per ball life, before falling off. Depends on
  // layout, restitution, bumpers — calibrate against playtesting.
  hitsPerBallLife: number;
  // Manual click rate, drops per second. 0 means "no manual play".
  manualDropsPerSec: number;
  // Average time (seconds) a parent ball spends in play before dying. Caps the
  // overall drop rate at maxBalls / ballLifetimeSec — i.e., you can't drop
  // faster than slots free up. Calibrate against playtesting; default ~5s.
  ballLifetimeSec: number;
}

export function expectedStartValue(state: Readonly<SaveData>): number {
  const premiumChance = Math.min(1, state.specialBalls.premium * TRAIT_CHANCE_PER_LEVEL);
  return DEFAULT_START_VALUE * (1 - premiumChance) + PREMIUM_START_VALUE * premiumChance;
}

export function expectedCritMultiplier(state: Readonly<SaveData>): number {
  const critTraitChance = Math.min(1, state.specialBalls.critical * TRAIT_CHANCE_PER_LEVEL);
  // Critical trait adds +50% on top of the base critical chance.
  const pCrit = Math.min(1, state.criticalChance + critTraitChance * 0.5);
  return (1 - pCrit) * 1 + pCrit * CRITICAL_BONUS;
}

export function expectedLivesPerBall(state: Readonly<SaveData>): number {
  const lifeChance = Math.min(1, state.specialBalls.life * TRAIT_CHANCE_PER_LEVEL);
  // Each ball gets 1 life by default; life trait adds 1 extra respawn when rolled.
  return 1 + lifeChance;
}

// Sum of a geometric series v0 * (1 + r + r^2 + ... + r^(n-1)).
function geometricSum(v0: number, r: number, n: number): number {
  if (n <= 0) return 0;
  if (Math.abs(r - 1) < 1e-9) return v0 * n;
  return (v0 * (Math.pow(r, n) - 1)) / (r - 1);
}

export function expectedScorePerBall(state: Readonly<SaveData>, params: IncomeParams): number {
  const hits = params.hitsPerBallLife;
  const bm = state.bounceMultiplier;
  const v0 = expectedStartValue(state);
  const baseSum = geometricSum(v0, bm, hits);
  const critMult = expectedCritMultiplier(state);
  const livesMult = expectedLivesPerBall(state);
  // Split trait: each hit has splitChance*SPLIT_SPAWN_CHANCE probability of
  // spawning a child ball that inherits current value and hits ~hits/2 more
  // times on average. Approximation — ignores recursive splits.
  const splitChance = Math.min(1, state.specialBalls.split * TRAIT_CHANCE_PER_LEVEL);
  const avgChildHits = Math.max(1, Math.floor(hits / 2));
  const childContribution =
    splitChance * SPLIT_SPAWN_CHANCE * hits * geometricSum(v0, bm, avgChildHits) * critMult;
  return baseSum * critMult * livesMult + childContribution * livesMult;
}

export function ballsPerSec(state: Readonly<SaveData>, params: IncomeParams): number {
  const autoPerSec =
    state.autoDropInterval > 0 ? state.multiDrop / (state.autoDropInterval / 1000) : 0;
  const manualPerSec = params.manualDropsPerSec * state.multiDrop;
  const sourceRate = autoPerSec + manualPerSec;
  // Parent balls occupy a slot for ballLifetimeSec; can't drop faster than
  // slots free up. Split-spawned children don't count against the cap.
  const slotCap = state.maxBalls / Math.max(0.1, params.ballLifetimeSec);
  return Math.min(sourceRate, slotCap);
}

export function incomePerSec(state: Readonly<SaveData>, params: IncomeParams): number {
  return expectedScorePerBall(state, params) * ballsPerSec(state, params);
}
