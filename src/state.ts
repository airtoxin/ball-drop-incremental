import type { Locale } from "./i18n";
import {
  ALL_UPGRADE_IDS,
  AUTO_DROP_BASE_INTERVAL,
  AUTO_DROP_MIN_INTERVAL,
  AUTO_DROP_STEP,
  CRITICAL_CHANCE_PER_LEVEL,
  MULTIPLIER_BASE,
  MULTIPLIER_STEP,
  RESTITUTION_STEP,
  UPGRADE_DEFS,
  getLevel,
} from "./economy";

const SAVE_KEY = "ball-drop-save";
const SETTINGS_KEY = "ball-drop-settings";

export interface SaveData {
  locale: Locale;
  collisionCount: number;
  // Monotonically-tracked max of collisionCount ever observed this save.
  // Drives shop reveal thresholds so items stay visible after purchase.
  peakCoins: number;
  maxBalls: number;
  ballRestitution: number;
  autoDropInterval: number;
  bounceMultiplier: number;
  criticalChance: number;
  multiDrop: number;
  expandRows: number;
  expandCols: number;
  hasBumpers: boolean;
  hasZigzag: boolean;
  hasSpecialBalls: boolean;
  specialBalls: {
    big: number;
    premium: number;
    critical: number;
    life: number;
    split: number;
  };
  upgrades: {
    maxBalls: number;
    restitution: number;
    autoDrop: number;
    bounceMultiplier: number;
    critical: number;
    multiDrop: number;
  };
  muted: boolean;
  volume: {
    kick: number;
    hihat: number;
    synth: number;
  };
}

export const defaults: SaveData = {
  locale: "ja",
  collisionCount: 0,
  peakCoins: 0,
  maxBalls: 1,
  ballRestitution: 0.9,
  autoDropInterval: 0,
  bounceMultiplier: 1,
  criticalChance: 0,
  multiDrop: 1,
  expandRows: 0,
  expandCols: 0,
  hasBumpers: false,
  hasZigzag: false,
  hasSpecialBalls: false,
  specialBalls: {
    big: 0,
    premium: 0,
    critical: 0,
    life: 0,
    split: 0,
  },
  upgrades: {
    maxBalls: 0,
    restitution: 0,
    autoDrop: 0,
    bounceMultiplier: 0,
    critical: 0,
    multiDrop: 0,
  },
  muted: false,
  volume: {
    kick: -4,
    hihat: -10,
    synth: -8,
  },
};

let current: SaveData = structuredClone(defaults);

const listeners = new Set<() => void>();

export function getState(): Readonly<SaveData> {
  return current;
}

export function updateState(patch: Partial<SaveData>): void {
  Object.assign(current, patch);
  if (current.collisionCount > current.peakCoins) {
    current.peakCoins = current.collisionCount;
  }
  for (const fn of listeners) fn();
}

export function updateUpgrades(patch: Partial<SaveData["upgrades"]>): void {
  Object.assign(current.upgrades, patch);
  for (const fn of listeners) fn();
}

export function updateSpecialBalls(patch: Partial<SaveData["specialBalls"]>): void {
  Object.assign(current.specialBalls, patch);
  for (const fn of listeners) fn();
}

export function updateVolume(patch: Partial<SaveData["volume"]>): void {
  Object.assign(current.volume, patch);
  for (const fn of listeners) fn();
}

export function onChange(fn: () => void): void {
  listeners.add(fn);
}

let saveDisabled = false;

export function disableSave(): void {
  saveDisabled = true;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Keyed hash for localStorage integrity. Not cryptographic — the key ships in
// the bundle, so a determined attacker can still forge signatures. Goal is to
// deter casual JSON edits by making the on-disk format opaque and any naive
// change invalidate the signature.
const SIGN_KEY = "bd-inc-9f3a-sig-v1-5c7e-e86d";
const SAVE_VERSION = 1;

// cyrb53 — 53-bit non-cryptographic hash, deterministic, sync. Output fits in
// a JS safe integer. Collision odds ≈ 1 in 9e15 per random perturbation.
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function sign(dataStr: string): string {
  return cyrb53(SIGN_KEY + dataStr + SIGN_KEY).toString(36);
}

// Cheap integrity check for loaded saves. Catches direct localStorage edits by
// verifying that derived fields (maxBalls, bounceMultiplier, …) match what the
// purchase handlers would produce from the underlying upgrade levels. A
// determined attacker can still forge a consistent state, but naive "set
// collisionCount to 1e12" edits trip at least one invariant.
function isValid(s: SaveData): boolean {
  const nums = [
    s.collisionCount,
    s.peakCoins,
    s.maxBalls,
    s.ballRestitution,
    s.autoDropInterval,
    s.bounceMultiplier,
    s.criticalChance,
    s.multiDrop,
    s.expandRows,
    s.expandCols,
  ];
  for (const n of nums) {
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return false;
  }

  if (s.peakCoins < s.collisionCount) return false;

  for (const id of ALL_UPGRADE_IDS) {
    const lvl = getLevel(s, id);
    if (typeof lvl !== "number" || !Number.isFinite(lvl) || lvl < 0) return false;
    if (lvl > UPGRADE_DEFS[id].maxLevel) return false;
  }

  if (s.maxBalls !== defaults.maxBalls + s.upgrades.maxBalls) return false;
  if (s.multiDrop !== defaults.multiDrop + s.upgrades.multiDrop) return false;
  if (
    s.ballRestitution !==
    round2(defaults.ballRestitution + s.upgrades.restitution * RESTITUTION_STEP)
  )
    return false;
  if (
    s.bounceMultiplier !== round2(MULTIPLIER_BASE + s.upgrades.bounceMultiplier * MULTIPLIER_STEP)
  )
    return false;
  if (s.criticalChance !== round2(s.upgrades.critical * CRITICAL_CHANCE_PER_LEVEL)) return false;

  if (s.upgrades.autoDrop === 0) {
    if (s.autoDropInterval !== 0) return false;
  } else {
    const expected = Math.max(
      AUTO_DROP_MIN_INTERVAL,
      AUTO_DROP_BASE_INTERVAL - (s.upgrades.autoDrop - 1) * AUTO_DROP_STEP,
    );
    if (s.autoDropInterval !== expected) return false;
  }

  const traitSum =
    s.specialBalls.big +
    s.specialBalls.premium +
    s.specialBalls.critical +
    s.specialBalls.life +
    s.specialBalls.split;
  if (traitSum > 0 && !s.hasSpecialBalls) return false;

  return true;
}

export function save(): void {
  if (saveDisabled) return;
  const dataStr = JSON.stringify(current);
  const envelope = { v: SAVE_VERSION, d: current, s: sign(dataStr) };
  localStorage.setItem(SAVE_KEY, JSON.stringify(envelope));
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ volume: current.volume, locale: current.locale, muted: current.muted }),
  );
}

export function load(): void {
  // Load settings first (persists across reset)
  const settingsRaw = localStorage.getItem(SETTINGS_KEY);
  let settings: { volume?: Partial<SaveData["volume"]>; locale?: Locale; muted?: boolean } = {};
  if (settingsRaw) {
    try {
      settings = JSON.parse(settingsRaw);
    } catch {
      /* ignore */
    }
  }

  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) {
    try {
      const outer = JSON.parse(raw) as unknown;
      let parsed: Partial<SaveData> | null = null;

      if (outer && typeof outer === "object" && "v" in outer) {
        const env = outer as { v: unknown; d: unknown; s: unknown };
        if (
          env.v === SAVE_VERSION &&
          typeof env.s === "string" &&
          env.d &&
          typeof env.d === "object" &&
          sign(JSON.stringify(env.d)) === env.s
        ) {
          parsed = env.d as Partial<SaveData>;
        }
      }

      if (parsed) {
        current = {
          ...structuredClone(defaults),
          ...parsed,
          specialBalls: { ...structuredClone(defaults.specialBalls), ...parsed.specialBalls },
          upgrades: { ...structuredClone(defaults.upgrades), ...parsed.upgrades },
          volume: { ...structuredClone(defaults.volume), ...parsed.volume },
        };
      }

      if (!parsed || !isValid(current)) {
        current = structuredClone(defaults);
        localStorage.removeItem(SAVE_KEY);
      }
    } catch {
      // corrupted save — start fresh
    }
  }

  // Settings always override (survive reset)
  if (settings.volume) Object.assign(current.volume, settings.volume);
  if (settings.locale) current.locale = settings.locale;
  if (settings.muted != null) current.muted = settings.muted;
}
