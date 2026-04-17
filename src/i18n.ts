const translations = {
  en: {
    shop: "Shop",
    maxBalls: "Max Balls",
    restitution: "Restitution",
    autoDrop: "Auto Drop",
    multiplier: "Multiplier",
    critical: "Critical",
    multiDrop: "Multi Drop",
    expandRows: "Rows",
    expandCols: "Columns",
    bumpers: "Bumpers",
    zigzag: "Zigzag",
    on: "ON",
    off: "OFF",
    max: "MAX",
    purchased: "PURCHASED",
    buy: "BUY",
    kick: "Kick",
    hihat: "Hi-Hat",
    synth: "Synth",
    language: "Language",
    traits: "Traits",
    traitBig: "Big",
    traitPremium: "Premium",
    traitCritical: "Critical",
    traitLife: "Life",
    unlock: "UNLOCK",
    reset: "Reset",
    resetConfirm: "Are you sure? All progress will be lost.",
    clickToStart: "Click to Start",
  },
  ja: {
    shop: "ショップ",
    maxBalls: "最大ボール数",
    restitution: "反発力",
    autoDrop: "自動落下",
    multiplier: "倍率",
    critical: "クリティカル",
    multiDrop: "マルチドロップ",
    expandRows: "行数",
    expandCols: "列数",
    bumpers: "バンパー",
    zigzag: "ジグザグ",
    on: "ON",
    off: "OFF",
    max: "MAX",
    purchased: "購入済",
    buy: "購入",
    kick: "キック",
    hihat: "ハイハット",
    synth: "シンセ",
    language: "言語",
    traits: "特性",
    traitBig: "ビッグ",
    traitPremium: "高級",
    traitCritical: "クリティカル",
    traitLife: "ライフ",
    unlock: "解放",
    reset: "リセット",
    resetConfirm: "本当にリセットしますか？すべての進行が失われます。",
    clickToStart: "クリックでスタート",
  },
} as const;

export type Locale = keyof typeof translations;
export type TranslationKey = keyof (typeof translations)["en"];

let currentLocale: Locale = "en";

const localeListeners = new Set<() => void>();

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  for (const fn of localeListeners) fn();
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: TranslationKey): string {
  return translations[currentLocale][key];
}

export function onLocaleChange(fn: () => void): void {
  localeListeners.add(fn);
}
