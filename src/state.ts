import type { Locale } from "./i18n";

const SAVE_KEY = "ball-drop-save";

export interface SaveData {
  locale: Locale;
  collisionCount: number;
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
  };
  upgrades: {
    maxBalls: number;
    restitution: number;
    autoDrop: number;
    bounceMultiplier: number;
    critical: number;
    multiDrop: number;
  };
  volume: {
    kick: number;
    hihat: number;
    synth: number;
  };
}

const defaults: SaveData = {
  locale: "en",
  collisionCount: 0,
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
  },
  upgrades: {
    maxBalls: 0,
    restitution: 0,
    autoDrop: 0,
    bounceMultiplier: 0,
    critical: 0,
    multiDrop: 0,
  },
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

export function save(): void {
  if (saveDisabled) return;
  localStorage.setItem(SAVE_KEY, JSON.stringify(current));
}

export function load(): void {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    current = {
      ...structuredClone(defaults),
      ...parsed,
      specialBalls: { ...structuredClone(defaults.specialBalls), ...parsed.specialBalls },
      upgrades: { ...structuredClone(defaults.upgrades), ...parsed.upgrades },
      volume: { ...structuredClone(defaults.volume), ...parsed.volume },
    };
  } catch {
    // corrupted save — start fresh
  }
}
