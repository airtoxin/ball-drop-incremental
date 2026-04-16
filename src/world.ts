import Matter from "matter-js";
import { play, getDuration, setKickVolume, setHihatVolume, setSynthVolume } from "./synth";
import { getState, updateState, updateUpgrades, updateSpecialBalls, updateVolume, onChange, disableSave } from "./state";
import { t, getLocale, setLocale, onLocaleChange } from "./i18n";
import type { Locale } from "./i18n";

const { Engine, Render, Runner, Body, Bodies, Composite, Events } = Matter;

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1080;
const GRID_SIZE = 100;
const BALL_RADIUS = 10;
const WALL_COLOR = "#4a4a6a";
const FLASH_COLOR = "#ffffff";
const FLASH_DURATION = 150;

function createObstacles(width: number, height: number, zigzag: boolean, expandRows: number, expandCols: number): Matter.Body[] {
  const bodies: Matter.Body[] = [];
  const cols = Math.ceil(width / GRID_SIZE);
  const rows = Math.ceil(height / GRID_SIZE);
  const centerCol = Math.floor(cols / 2);
  const centerRow = Math.floor(rows / 2);
  // Start with 3x3, expand by 2 per level
  const halfCols = 1 + expandCols;
  const halfRows = 1 + expandRows;

  for (let gy = 0; gy < rows; gy++) {
    const isEvenRow = gy % 2 === 0;
    const zigzagRow = zigzag && isEvenRow;
    for (let gx = 0; gx < cols; gx++) {
      if (gx < centerCol - halfCols || gx > centerCol + halfCols + (zigzagRow ? 1 : 0)) continue;
      if (gy < centerRow - halfRows || gy > centerRow + halfRows) continue;
      const offset = zigzagRow ? -GRID_SIZE / 2 : 0;
      const x = gx * GRID_SIZE + GRID_SIZE / 2 + offset;
      const y = gy * GRID_SIZE + GRID_SIZE / 2;
      const angle = -Math.PI / 3 + (Math.random() * Math.PI) / 3;
      const opts: Matter.IChamferableBodyDefinition = {
        isStatic: true,
        angle,
        render: {
          fillStyle: "#4a4a6a",
        },
      };

      const isTriangle = (gx + gy) % 4 !== 0;
      const body = isTriangle
        ? Bodies.polygon(x, y, 3, GRID_SIZE / 4, { ...opts, label: "triangle" })
        : Bodies.circle(x, y, GRID_SIZE / 5, opts);

      bodies.push(body);
    }
  }
  return bodies;
}

type BallTrait = "big" | "premium" | "critical" | "life";

interface BallMeta {
  value: number;
  traits: Set<BallTrait>;
  lives: number;
}

const TRAIT_CHANCE_PER_LEVEL = 0.1;
const BIG_RADIUS_MULT = 2.5;

const TRAIT_COLORS: Record<BallTrait, [number, number, number]> = {
  big: [204, 204, 204],       // same gray, size is the indicator
  premium: [255, 215, 0],     // gold
  critical: [255, 80, 80],    // red
  life: [80, 255, 80],        // green
};

function rollTraits(): Set<BallTrait> {
  const s = getState();
  if (!s.hasSpecialBalls) return new Set();
  const traits = new Set<BallTrait>();
  const types: BallTrait[] = ["big", "premium", "critical", "life"];
  for (const t of types) {
    const chance = s.specialBalls[t] * TRAIT_CHANCE_PER_LEVEL;
    if (chance > 0 && Math.random() < chance) {
      traits.add(t);
    }
  }
  return traits;
}

function traitColor(traits: Set<BallTrait>): string {
  const colorTraits = (["premium", "critical", "life"] as BallTrait[]).filter(t => traits.has(t));
  if (colorTraits.length === 0) return "#cccccc";
  let r = 0, g = 0, b = 0;
  for (const t of colorTraits) {
    const [cr, cg, cb] = TRAIT_COLORS[t];
    r += cr; g += cg; b += cb;
  }
  r = Math.round(r / colorTraits.length);
  g = Math.round(g / colorTraits.length);
  b = Math.round(b / colorTraits.length);
  return `rgb(${r},${g},${b})`;
}

function createBall(x: number, traits: Set<BallTrait>): Matter.Body {
  const radius = traits.has("big") ? BALL_RADIUS * BIG_RADIUS_MULT : BALL_RADIUS;
  return Bodies.circle(x, 0, radius, {
    label: `ball_${getDuration()}`,
    restitution: getState().ballRestitution,
    friction: 0,
    density: 1000,
    render: {
      fillStyle: traitColor(traits),
    },
  });
}

function createSettingsMenu(container: HTMLElement): HTMLElement {
  const menu = document.createElement("div");
  menu.id = "settings-menu";
  menu.hidden = true;

  const state = getState();
  type SliderDef = { labelKey: "kick" | "hihat" | "synth"; key: keyof typeof state.volume; setFn: (db: number) => void };
  const sliders: SliderDef[] = [
    { labelKey: "kick", key: "kick", setFn: setKickVolume },
    { labelKey: "hihat", key: "hihat", setFn: setHihatVolume },
    { labelKey: "synth", key: "synth", setFn: setSynthVolume },
  ];

  const sliderLabels: HTMLElement[] = [];

  for (const s of sliders) {
    const row = document.createElement("div");
    row.className = "settings-row";

    const label = document.createElement("label");
    label.textContent = t(s.labelKey);
    sliderLabels.push(label);

    const input = document.createElement("input");
    input.type = "range";
    input.min = "-30";
    input.max = "0";
    input.value = String(getState().volume[s.key]);
    input.addEventListener("input", () => {
      const val = Number(input.value);
      s.setFn(val <= -30 ? -Infinity : val);
      updateVolume({ [s.key]: val });
    });

    row.appendChild(label);
    row.appendChild(input);
    menu.appendChild(row);
  }

  // Language selector
  const langRow = document.createElement("div");
  langRow.className = "settings-row";

  const langLabel = document.createElement("label");
  langLabel.textContent = t("language");

  const langSelect = document.createElement("select");
  langSelect.className = "lang-select";
  for (const [value, label] of [["en", "English"], ["ja", "日本語"]] as const) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (getLocale() === value) opt.selected = true;
    langSelect.appendChild(opt);
  }
  langSelect.addEventListener("change", () => {
    const locale = langSelect.value as Locale;
    setLocale(locale);
    updateState({ locale });
  });

  langRow.appendChild(langLabel);
  langRow.appendChild(langSelect);
  menu.appendChild(langRow);

  // Reset button
  const resetRow = document.createElement("div");
  resetRow.className = "settings-row";

  const resetLabel = document.createElement("label");
  resetLabel.textContent = "";

  const resetBtn = document.createElement("button");
  resetBtn.className = "settings-btn settings-btn-danger";
  resetBtn.textContent = t("reset");
  resetBtn.addEventListener("click", () => {
    if (window.confirm(t("resetConfirm"))) {
      disableSave();
      localStorage.removeItem("ball-drop-save");
      window.location.reload();
    }
  });

  resetRow.appendChild(resetLabel);
  resetRow.appendChild(resetBtn);
  menu.appendChild(resetRow);

  // Update labels on locale change
  onLocaleChange(() => {
    for (let i = 0; i < sliders.length; i++) {
      sliderLabels[i].textContent = t(sliders[i].labelKey);
    }
    langLabel.textContent = t("language");
    resetBtn.textContent = t("reset");
  });

  container.appendChild(menu);
  return menu;
}

function createBumpers(width: number, height: number): Matter.Body[] {
  const BUMPER_WIDTH = 100;
  const bumperOpts: Matter.IChamferableBodyDefinition = {
    isStatic: true,
    restitution: 1,
    render: { fillStyle: "#7a7aff" },
    label: "bumper",
  };
  const VISIBLE_EDGE = 5;
  return [
    Bodies.rectangle(VISIBLE_EDGE - BUMPER_WIDTH / 2, height / 2, BUMPER_WIDTH, height, bumperOpts),
    Bodies.rectangle(width - VISIBLE_EDGE + BUMPER_WIDTH / 2, height / 2, BUMPER_WIDTH, height, bumperOpts),
  ];
}

function createShopMenu(container: HTMLElement, counterEl: HTMLElement, onAddBall: () => void, onAddBumpers: () => void, onZigzag: () => void, onRebuildObstacles: () => void): void {
  const btn = document.createElement("button");
  btn.id = "hamburger-btn";
  btn.innerHTML = "&#9776;";
  container.appendChild(btn);

  const panel = document.createElement("div");
  panel.id = "shop-panel";

  const title = document.createElement("h3");
  title.className = "shop-title";
  title.textContent = t("shop");
  panel.appendChild(title);

  onLocaleChange(() => {
    title.textContent = t("shop");
  });

  // Visibility system: items can declare unlock conditions
  const conditionalRows: { row: HTMLElement; visible: () => boolean }[] = [];

  function registerRow(row: HTMLElement, visible?: () => boolean): void {
    if (visible) conditionalRows.push({ row, visible });
  }

  // Max balls upgrade
  const maxBallsRow = document.createElement("div");
  maxBallsRow.className = "shop-item";

  const maxBallsLabel = document.createElement("span");
  const maxBallsCost = 100;

  const maxBallsBtn = document.createElement("button");
  maxBallsBtn.className = "shop-buy-btn";
  maxBallsBtn.textContent = `+1 (${maxBallsCost})`;
  maxBallsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    if (s.collisionCount >= maxBallsCost) {
      updateState({ collisionCount: s.collisionCount - maxBallsCost, maxBalls: s.maxBalls + 1 });
      updateUpgrades({ maxBalls: s.upgrades.maxBalls + 1 });
      counterEl.textContent = String(getState().collisionCount);
    }
  });

  maxBallsRow.appendChild(maxBallsLabel);
  maxBallsRow.appendChild(maxBallsBtn);
  panel.appendChild(maxBallsRow);

  // Restitution upgrade
  const restitutionRow = document.createElement("div");
  restitutionRow.className = "shop-item";

  const restitutionLabel = document.createElement("span");
  const restitutionCost = 200;

  const restitutionBtn = document.createElement("button");
  restitutionBtn.className = "shop-buy-btn";
  restitutionBtn.textContent = `+0.05 (${restitutionCost})`;
  restitutionBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    if (s.collisionCount >= restitutionCost) {
      updateState({
        collisionCount: s.collisionCount - restitutionCost,
        ballRestitution: Math.round((s.ballRestitution + 0.05) * 100) / 100,
      });
      updateUpgrades({ restitution: s.upgrades.restitution + 1 });
      counterEl.textContent = String(getState().collisionCount);
    }
  });

  restitutionRow.appendChild(restitutionLabel);
  restitutionRow.appendChild(restitutionBtn);
  panel.appendChild(restitutionRow);

  // Auto drop upgrade
  const autoDropRow = document.createElement("div");
  autoDropRow.className = "shop-item";

  const autoDropLabel = document.createElement("span");
  const autoDropCost = 300;
  const AUTO_DROP_BASE_INTERVAL = 10000;
  const AUTO_DROP_MIN_INTERVAL = 1000;

  const autoDropBtn = document.createElement("button");
  autoDropBtn.className = "shop-buy-btn";

  let autoDropTimer: ReturnType<typeof setInterval> | null = null;

  function startAutoDrop(interval: number): void {
    if (autoDropTimer != null) clearInterval(autoDropTimer);
    autoDropTimer = setInterval(onAddBall, interval);
  }

  autoDropBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    if (s.collisionCount >= autoDropCost) {
      const newLevel = s.upgrades.autoDrop + 1;
      const newInterval = Math.max(
        AUTO_DROP_MIN_INTERVAL,
        AUTO_DROP_BASE_INTERVAL - (newLevel - 1) * 1000,
      );
      updateState({
        collisionCount: s.collisionCount - autoDropCost,
        autoDropInterval: newInterval,
      });
      updateUpgrades({ autoDrop: newLevel });
      counterEl.textContent = String(getState().collisionCount);
      startAutoDrop(newInterval);
    }
  });

  autoDropRow.appendChild(autoDropLabel);
  autoDropRow.appendChild(autoDropBtn);
  panel.appendChild(autoDropRow);

  // Resume auto drop from saved state
  const savedState = getState();
  if (savedState.autoDropInterval > 0) {
    startAutoDrop(savedState.autoDropInterval);
  }

  // Bounce multiplier upgrade
  const multiplierRow = document.createElement("div");
  multiplierRow.className = "shop-item";

  const multiplierLabel = document.createElement("span");
  const multiplierCost = 500;
  const MULTIPLIER_STEP = 0.05;
  const MULTIPLIER_MAX = 2;

  const multiplierBtn = document.createElement("button");
  multiplierBtn.className = "shop-buy-btn";
  multiplierBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    if (s.collisionCount >= multiplierCost && s.bounceMultiplier < MULTIPLIER_MAX) {
      const newMult = Math.min(
        MULTIPLIER_MAX,
        Math.round((s.bounceMultiplier + MULTIPLIER_STEP) * 100) / 100,
      );
      updateState({
        collisionCount: s.collisionCount - multiplierCost,
        bounceMultiplier: newMult,
      });
      updateUpgrades({ bounceMultiplier: s.upgrades.bounceMultiplier + 1 });
      counterEl.textContent = String(getState().collisionCount);
    }
  });

  multiplierRow.appendChild(multiplierLabel);
  multiplierRow.appendChild(multiplierBtn);
  panel.appendChild(multiplierRow);

  // Critical chance upgrade
  const criticalRow = document.createElement("div");
  criticalRow.className = "shop-item";

  const criticalLabel = document.createElement("span");
  const criticalCost = 400;
  const CRITICAL_CHANCE_PER_LEVEL = 0.05;
  const CRITICAL_MAX_CHANCE = 0.5;
  const CRITICAL_BONUS = 5;

  const criticalBtn = document.createElement("button");
  criticalBtn.className = "shop-buy-btn";
  criticalBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    if (s.collisionCount >= criticalCost && s.criticalChance < CRITICAL_MAX_CHANCE) {
      const newChance = Math.min(
        CRITICAL_MAX_CHANCE,
        Math.round((s.criticalChance + CRITICAL_CHANCE_PER_LEVEL) * 100) / 100,
      );
      updateState({
        collisionCount: s.collisionCount - criticalCost,
        criticalChance: newChance,
      });
      updateUpgrades({ critical: s.upgrades.critical + 1 });
      counterEl.textContent = String(getState().collisionCount);
    }
  });

  criticalRow.appendChild(criticalLabel);
  criticalRow.appendChild(criticalBtn);
  panel.appendChild(criticalRow);

  // Multi drop upgrade
  const multiDropRow = document.createElement("div");
  multiDropRow.className = "shop-item";

  const multiDropLabel = document.createElement("span");
  const multiDropCost = 400;

  const multiDropBtn = document.createElement("button");
  multiDropBtn.className = "shop-buy-btn";
  multiDropBtn.textContent = `+1 (${multiDropCost})`;
  multiDropBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    if (s.collisionCount >= multiDropCost) {
      updateState({
        collisionCount: s.collisionCount - multiDropCost,
        multiDrop: s.multiDrop + 1,
      });
      updateUpgrades({ multiDrop: s.upgrades.multiDrop + 1 });
      counterEl.textContent = String(getState().collisionCount);
    }
  });

  multiDropRow.appendChild(multiDropLabel);
  multiDropRow.appendChild(multiDropBtn);
  panel.appendChild(multiDropRow);

  // Expand rows upgrade
  const expandRowsRow = document.createElement("div");
  expandRowsRow.className = "shop-item";

  const expandRowsLabel = document.createElement("span");
  const expandRowsCost = 300;
  const EXPAND_ROWS_MAX = 2;

  const expandRowsBtn = document.createElement("button");
  expandRowsBtn.className = "shop-buy-btn";
  expandRowsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    if (s.collisionCount >= expandRowsCost && s.expandRows < EXPAND_ROWS_MAX) {
      updateState({
        collisionCount: s.collisionCount - expandRowsCost,
        expandRows: s.expandRows + 1,
      });
      counterEl.textContent = String(getState().collisionCount);
      onRebuildObstacles();
    }
  });

  expandRowsRow.appendChild(expandRowsLabel);
  expandRowsRow.appendChild(expandRowsBtn);
  panel.appendChild(expandRowsRow);

  // Expand columns upgrade
  const expandColsRow = document.createElement("div");
  expandColsRow.className = "shop-item";

  const expandColsLabel = document.createElement("span");
  const expandColsCost = 300;
  const EXPAND_COLS_MAX = 6;

  const expandColsBtn = document.createElement("button");
  expandColsBtn.className = "shop-buy-btn";
  expandColsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    if (s.collisionCount >= expandColsCost && s.expandCols < EXPAND_COLS_MAX) {
      updateState({
        collisionCount: s.collisionCount - expandColsCost,
        expandCols: s.expandCols + 1,
      });
      counterEl.textContent = String(getState().collisionCount);
      onRebuildObstacles();
    }
  });

  expandColsRow.appendChild(expandColsLabel);
  expandColsRow.appendChild(expandColsBtn);
  panel.appendChild(expandColsRow);

  // Bumpers upgrade (one-time purchase)
  const bumperRow = document.createElement("div");
  bumperRow.className = "shop-item";

  const bumperLabel = document.createElement("span");
  const bumperCost = 600;

  const bumperBtn = document.createElement("button");
  bumperBtn.className = "shop-buy-btn";
  bumperBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    if (s.collisionCount >= bumperCost && !s.hasBumpers) {
      updateState({
        collisionCount: s.collisionCount - bumperCost,
        hasBumpers: true,
      });
      counterEl.textContent = String(getState().collisionCount);
      onAddBumpers();
    }
  });

  bumperRow.appendChild(bumperLabel);
  bumperRow.appendChild(bumperBtn);
  panel.appendChild(bumperRow);

  // Zigzag upgrade (one-time purchase)
  const zigzagRow = document.createElement("div");
  zigzagRow.className = "shop-item";

  const zigzagLabel = document.createElement("span");
  const zigzagCost = 800;

  const zigzagBtn = document.createElement("button");
  zigzagBtn.className = "shop-buy-btn";
  zigzagBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    if (s.collisionCount >= zigzagCost && !s.hasZigzag) {
      updateState({
        collisionCount: s.collisionCount - zigzagCost,
        hasZigzag: true,
      });
      counterEl.textContent = String(getState().collisionCount);
      onZigzag();
    }
  });

  zigzagRow.appendChild(zigzagLabel);
  zigzagRow.appendChild(zigzagBtn);
  panel.appendChild(zigzagRow);

  // Traits unlock (one-time)
  const traitsUnlockRow = document.createElement("div");
  traitsUnlockRow.className = "shop-item";

  const traitsUnlockLabel = document.createElement("span");
  const traitsUnlockCost = 1000;

  const traitsUnlockBtn = document.createElement("button");
  traitsUnlockBtn.className = "shop-buy-btn";
  traitsUnlockBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    if (s.collisionCount >= traitsUnlockCost && !s.hasSpecialBalls) {
      updateState({
        collisionCount: s.collisionCount - traitsUnlockCost,
        hasSpecialBalls: true,
      });
      counterEl.textContent = String(getState().collisionCount);
    }
  });

  traitsUnlockRow.appendChild(traitsUnlockLabel);
  traitsUnlockRow.appendChild(traitsUnlockBtn);
  panel.appendChild(traitsUnlockRow);

  // Individual trait items
  type TraitKey = "big" | "premium" | "critical" | "life";
  const traitDefs: { key: TraitKey; labelKey: "traitBig" | "traitPremium" | "traitCritical" | "traitLife"; cost: number }[] = [
    { key: "big", labelKey: "traitBig", cost: 500 },
    { key: "premium", labelKey: "traitPremium", cost: 500 },
    { key: "critical", labelKey: "traitCritical", cost: 500 },
    { key: "life", labelKey: "traitLife", cost: 500 },
  ];

  const traitLabels: HTMLElement[] = [];
  const traitBtns: HTMLButtonElement[] = [];

  for (const def of traitDefs) {
    const row = document.createElement("div");
    row.className = "shop-item";

    const label = document.createElement("span");
    traitLabels.push(label);

    const btn = document.createElement("button");
    btn.className = "shop-buy-btn";
    traitBtns.push(btn);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const s = getState();
      if (s.hasSpecialBalls && s.collisionCount >= def.cost) {
        updateState({ collisionCount: s.collisionCount - def.cost });
        updateSpecialBalls({ [def.key]: s.specialBalls[def.key] + 1 });
        counterEl.textContent = String(getState().collisionCount);
      }
    });

    row.appendChild(label);
    row.appendChild(btn);
    panel.appendChild(row);
    registerRow(row, () => getState().hasSpecialBalls);
  }

  // Update labels on state change
  const refreshLabels = () => {
    const s = getState();
    maxBallsLabel.textContent = `${t("maxBalls")}: ${s.maxBalls}`;
    restitutionLabel.textContent = `${t("restitution")}: ${s.ballRestitution.toFixed(2)}`;
    if (s.autoDropInterval > 0) {
      autoDropLabel.textContent = `${t("autoDrop")}: ${(s.autoDropInterval / 1000).toFixed(1)}s`;
      autoDropBtn.textContent = s.autoDropInterval <= AUTO_DROP_MIN_INTERVAL
        ? t("max")
        : `-1s (${autoDropCost})`;
      autoDropBtn.disabled = s.autoDropInterval <= AUTO_DROP_MIN_INTERVAL;
    } else {
      autoDropLabel.textContent = `${t("autoDrop")}: ${t("off")}`;
      autoDropBtn.textContent = `${t("on")} (${autoDropCost})`;
    }
    multiplierLabel.textContent = `${t("multiplier")}: x${s.bounceMultiplier.toFixed(2)}`;
    if (s.bounceMultiplier >= MULTIPLIER_MAX) {
      multiplierBtn.textContent = t("max");
      multiplierBtn.disabled = true;
    } else {
      multiplierBtn.textContent = `+0.05 (${multiplierCost})`;
      multiplierBtn.disabled = false;
    }
    if (s.criticalChance >= CRITICAL_MAX_CHANCE) {
      criticalLabel.textContent = `${t("critical")}: ${Math.round(s.criticalChance * 100)}% (x${CRITICAL_BONUS})`;
      criticalBtn.textContent = t("max");
      criticalBtn.disabled = true;
    } else {
      criticalLabel.textContent = `${t("critical")}: ${Math.round(s.criticalChance * 100)}% (x${CRITICAL_BONUS})`;
      criticalBtn.textContent = `+5% (${criticalCost})`;
    }
    multiDropLabel.textContent = `${t("multiDrop")}: ${s.multiDrop}`;
    const totalRows = 3 + s.expandRows * 2;
    if (s.expandRows >= EXPAND_ROWS_MAX) {
      expandRowsLabel.textContent = `${t("expandRows")}: ${totalRows}`;
      expandRowsBtn.textContent = t("max");
      expandRowsBtn.disabled = true;
    } else {
      expandRowsLabel.textContent = `${t("expandRows")}: ${totalRows}`;
      expandRowsBtn.textContent = `+2 (${expandRowsCost})`;
    }
    const totalCols = 3 + s.expandCols * 2;
    if (s.expandCols >= EXPAND_COLS_MAX) {
      expandColsLabel.textContent = `${t("expandCols")}: ${totalCols}`;
      expandColsBtn.textContent = t("max");
      expandColsBtn.disabled = true;
    } else {
      expandColsLabel.textContent = `${t("expandCols")}: ${totalCols}`;
      expandColsBtn.textContent = `+2 (${expandColsCost})`;
    }
    if (s.hasBumpers) {
      bumperLabel.textContent = `${t("bumpers")}: ${t("on")}`;
      bumperBtn.textContent = t("purchased");
      bumperBtn.disabled = true;
    } else {
      bumperLabel.textContent = `${t("bumpers")}: ${t("off")}`;
      bumperBtn.textContent = `${t("buy")} (${bumperCost})`;
    }
    if (s.hasZigzag) {
      zigzagLabel.textContent = `${t("zigzag")}: ${t("on")}`;
      zigzagBtn.textContent = t("purchased");
      zigzagBtn.disabled = true;
    } else {
      zigzagLabel.textContent = `${t("zigzag")}: ${t("off")}`;
      zigzagBtn.textContent = `${t("buy")} (${zigzagCost})`;
    }
    // Traits
    if (s.hasSpecialBalls) {
      traitsUnlockLabel.textContent = `${t("traits")}: ${t("on")}`;
      traitsUnlockBtn.textContent = t("purchased");
      traitsUnlockBtn.disabled = true;
      for (let i = 0; i < traitDefs.length; i++) {
        const def = traitDefs[i];
        const count = s.specialBalls[def.key];
        const pct = Math.min(count * TRAIT_CHANCE_PER_LEVEL * 100, 100);
        traitLabels[i].textContent = `${t(def.labelKey)}: ${pct}%`;
        if (pct >= 100) {
          traitBtns[i].textContent = t("max");
          traitBtns[i].disabled = true;
        } else {
          traitBtns[i].textContent = `+10% (${def.cost})`;
          traitBtns[i].disabled = false;
        }
      }
    } else {
      traitsUnlockLabel.textContent = `${t("traits")}: ${t("off")}`;
      traitsUnlockBtn.textContent = `${t("unlock")} (${traitsUnlockCost})`;
    }
    // Apply visibility conditions
    for (const item of conditionalRows) {
      item.row.hidden = !item.visible();
    }
  };
  onChange(refreshLabels);
  onLocaleChange(refreshLabels);
  refreshLabels();

  container.appendChild(panel);

  let open = false;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    open = !open;
    panel.classList.toggle("open", open);
  });
}

function showFloatText(container: HTMLElement, x: number, y: number, amount: number, critical: boolean): void {
  const el = document.createElement("div");
  el.className = critical ? "float-text float-text-critical" : "float-text";
  el.textContent = critical ? `+${amount}!` : `+${amount}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  container.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

function applyScale(container: HTMLElement): void {
  const scaleX = window.innerWidth / GAME_WIDTH;
  const scaleY = window.innerHeight / GAME_HEIGHT;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = (window.innerWidth - GAME_WIDTH * scale) / 2;
  const offsetY = (window.innerHeight - GAME_HEIGHT * scale) / 2;
  container.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}

export function createWorld(canvas: HTMLCanvasElement): void {
  const width = GAME_WIDTH;
  const height = GAME_HEIGHT;

  // Game container with fixed logical size
  const container = document.createElement("div");
  container.id = "game-container";
  canvas.parentElement!.appendChild(container);
  container.appendChild(canvas);

  canvas.width = width;
  canvas.height = height;

  applyScale(container);
  window.addEventListener("resize", () => applyScale(container));

  // Counter display
  const counterEl = document.createElement("div");
  counterEl.id = "counter";
  counterEl.textContent = String(getState().collisionCount);
  container.appendChild(counterEl);

  const engine = Engine.create({
    positionIterations: 10,
    velocityIterations: 10,
  });
  const render = Render.create({
    canvas,
    engine,
    options: {
      width,
      height,
      wireframes: false,
      background: "#1a1a2e",
    },
  });

  // Static obstacles
  let obstacles = createObstacles(width, height, getState().hasZigzag, getState().expandRows, getState().expandCols);
  Composite.add(engine.world, obstacles);

  // Track active balls and their metadata
  const balls = new Map<number, Matter.Body>();
  const ballMeta = new Map<number, BallMeta>();

  function addBall(x: number): void {
    const traits = rollTraits();
    const ball = createBall(x, traits);
    balls.set(ball.id, ball);
    ballMeta.set(ball.id, {
      value: traits.has("premium") ? 3 : 1,
      traits,
      lives: traits.has("life") ? 1 : 0,
    });
    Composite.add(engine.world, ball);
  }

  // Remove off-screen balls (life trait respawns once)
  Events.on(engine, "afterUpdate", () => {
    for (const [id, ball] of balls) {
      const { min } = ball.bounds;
      const outX = !getState().hasBumpers && (min.x < 0 || min.x > width);
      if (min.y > height || outX) {
        const meta = ballMeta.get(id);
        if (meta && meta.lives > 0 && min.y > height) {
          // Life trait: respawn at top with same value
          meta.lives--;
          Body.setPosition(ball, { x: ball.position.x, y: 0 });
          Body.setVelocity(ball, { x: 0, y: 0 });
        } else {
          balls.delete(id);
          ballMeta.delete(id);
          Composite.remove(engine.world, ball);
        }
      }
    }
  });

  // Collision -> sound
  Events.on(engine, "collisionStart", (event) => {
    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair;

      const ball = bodyA.label?.startsWith("ball")
        ? bodyA
        : bodyB.label?.startsWith("ball")
          ? bodyB
          : undefined;
      const wall = bodyA.isStatic ? bodyA : bodyB.isStatic ? bodyB : undefined;

      if (ball && wall) {
        const duration = ball.label.split("ball_")[1];
        const velocity = ball.speed > 10 ? 1 : ball.speed / 10;
        play(duration, velocity);

        // Flash the obstacle
        wall.render.fillStyle = FLASH_COLOR;
        setTimeout(() => {
          wall.render.fillStyle = WALL_COLOR;
        }, FLASH_DURATION);

        // Rotate triangle obstacles on hit
        if (wall.label === "triangle") {
          Body.rotate(wall, Math.PI / 18); // 10 degrees
        }

        // Score = ball's internal value, with critical bonus
        const s = getState();
        const meta = ballMeta.get(ball.id);
        const ballValue = meta?.value ?? 1;
        // Critical trait adds +50% to base crit chance
        const critChance = s.criticalChance + (meta?.traits.has("critical") ? 0.5 : 0);
        const isCritical = critChance > 0 && Math.random() < critChance;
        const amount = Math.floor(isCritical ? ballValue * 5 : ballValue);
        showFloatText(container, ball.position.x, ball.position.y, amount, isCritical);
        updateState({ collisionCount: s.collisionCount + amount });
        // Grow ball value by bounce multiplier for next hit
        if (meta) meta.value = ballValue * s.bounceMultiplier;
        counterEl.textContent = String(getState().collisionCount);
      }
    }
  });

  // Drop multiple balls respecting max limit
  function dropBalls(baseX: number, spread: boolean): void {
    const s = getState();
    for (let i = 0; i < s.multiDrop && balls.size < s.maxBalls; i++) {
      const x = spread ? baseX + (i - (s.multiDrop - 1) / 2) * (BALL_RADIUS * 8) : baseX;
      addBall(x);
    }
  }

  // Click to drop ball — convert screen coords to logical coords
  canvas.addEventListener("click", (e) => {
    if (balls.size < getState().maxBalls) {
      const rect = canvas.getBoundingClientRect();
      const logicalX = ((e.clientX - rect.left) / rect.width) * width;
      dropBalls(logicalX, true);
    }
  });

  // Start
  Render.run(render);
  const runner = Runner.create();
  Runner.run(runner, engine);

  // Bumper helper
  function addBumpers(): void {
    const bumpers = createBumpers(width, height);
    Composite.add(engine.world, bumpers);
  }

  // Restore bumpers from save
  if (getState().hasBumpers) {
    addBumpers();
  }

  // Shop menu
  function rebuildObstacles(): void {
    for (const ob of obstacles) {
      Composite.remove(engine.world, ob);
    }
    const st = getState();
    obstacles = createObstacles(width, height, st.hasZigzag, st.expandRows, st.expandCols);
    Composite.add(engine.world, obstacles);
  }

  createShopMenu(container, counterEl, () => {
    dropBalls(Math.random() * width, true);
  }, addBumpers, rebuildObstacles, rebuildObstacles);

  // Apply saved volume on init
  const vol = getState().volume;
  setKickVolume(vol.kick <= -30 ? -Infinity : vol.kick);
  setHihatVolume(vol.hihat <= -30 ? -Infinity : vol.hihat);
  setSynthVolume(vol.synth <= -30 ? -Infinity : vol.synth);

  // Mute toggle button (top-right, next to hamburger)
  const muteBtn = document.createElement("button");
  muteBtn.id = "mute-btn";
  muteBtn.textContent = "\u{1F50A}";
  let muted = false;
  let savedVolumes: { kick: number; hihat: number; synth: number } | null = null;

  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (muted) {
      if (savedVolumes) {
        setKickVolume(savedVolumes.kick <= -30 ? -Infinity : savedVolumes.kick);
        setHihatVolume(savedVolumes.hihat <= -30 ? -Infinity : savedVolumes.hihat);
        setSynthVolume(savedVolumes.synth <= -30 ? -Infinity : savedVolumes.synth);
        updateVolume(savedVolumes);
      }
      savedVolumes = null;
      muteBtn.textContent = "\u{1F50A}";
    } else {
      savedVolumes = { ...getState().volume };
      setKickVolume(-Infinity);
      setHihatVolume(-Infinity);
      setSynthVolume(-Infinity);
      updateVolume({ kick: -30, hihat: -30, synth: -30 });
      muteBtn.textContent = "\u{1F507}";
    }
    muted = !muted;
  });

  container.appendChild(muteBtn);

  // Settings menu
  const settingsMenu = createSettingsMenu(container);

  // Escape key toggles pause + settings
  let paused = false;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      paused = !paused;
      runner.enabled = !paused;
      settingsMenu.hidden = !paused;
    }
  });
}
