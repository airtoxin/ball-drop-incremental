import Matter from "matter-js";
import { play, getDuration, setKickVolume, setHihatVolume, setSynthVolume } from "./synth";
import {
  getState,
  updateState,
  updateUpgrades,
  updateSpecialBalls,
  updateVolume,
  onChange,
  disableSave,
} from "./state";
import { t, getLocale, setLocale, onLocaleChange } from "./i18n";
import type { Locale } from "./i18n";
import {
  ALL_TRAITS,
  BALL_COLOR,
  BALL_RADIUS,
  BIG_RADIUS_MULT,
  EffectQueue,
  createRespawnStreak,
  createSplitBurst,
  renderBallTraits,
  type BallMeta,
  type BallTrait,
} from "./effects";
import {
  AUTO_DROP_MIN_INTERVAL,
  CRITICAL_BONUS,
  CRITICAL_MAX_CHANCE,
  EXPAND_COLS_MAX,
  EXPAND_ROWS_MAX,
  MULTIPLIER_MAX,
  SPLIT_SPAWN_CHANCE,
  TRAIT_CHANCE_PER_LEVEL,
  costOf,
  getLevel,
  revealAtOf,
} from "./economy";

const { Engine, Render, Runner, Body, Bodies, Composite, Events } = Matter;

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1080;
const GRID_SIZE = 100;
const WALL_COLOR = "#4a4a6a";
const FLASH_COLOR = "#ffffff";
const FLASH_DURATION = 150;

function createObstacles(
  width: number,
  height: number,
  zigzag: boolean,
  expandRows: number,
  expandCols: number,
): Matter.Body[] {
  const bodies: Matter.Body[] = [];
  const cols = Math.ceil(width / GRID_SIZE);
  const rows = Math.ceil(height / GRID_SIZE);
  const centerCol = Math.floor(cols / 2);
  const centerRow = Math.floor(rows / 2);
  // Recenter grid so the obstacle cluster is symmetric around the play area.
  const gridShiftX = width / 2 - (centerCol * GRID_SIZE + GRID_SIZE / 2);
  const gridShiftY = height / 2 - (centerRow * GRID_SIZE + GRID_SIZE / 2);
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
      const x = gx * GRID_SIZE + GRID_SIZE / 2 + offset + gridShiftX;
      const y = gy * GRID_SIZE + GRID_SIZE / 2 + gridShiftY;
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

function rollTraits(): Set<BallTrait> {
  const s = getState();
  if (!s.hasSpecialBalls) return new Set();
  const traits = new Set<BallTrait>();
  for (const trait of ALL_TRAITS) {
    const chance = s.specialBalls[trait] * TRAIT_CHANCE_PER_LEVEL;
    if (chance > 0 && Math.random() < chance) {
      traits.add(trait);
    }
  }
  return traits;
}

function createBall(x: number, traits: Set<BallTrait>): Matter.Body {
  const radius = traits.has("big") ? BALL_RADIUS * BIG_RADIUS_MULT : BALL_RADIUS;
  return Bodies.circle(x, 0, radius, {
    label: `ball_${getDuration()}`,
    restitution: getState().ballRestitution,
    friction: 0,
    density: 1000,
    render: {
      fillStyle: BALL_COLOR,
    },
  });
}

function createSettingsMenu(container: HTMLElement, onVolumeChange: () => void): HTMLElement {
  const menu = document.createElement("div");
  menu.id = "settings-menu";
  menu.hidden = true;

  const state = getState();
  type SliderDef = {
    labelKey: "kick" | "hihat" | "synth";
    key: keyof typeof state.volume;
    setFn: (db: number) => void;
  };
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
      updateVolume({ [s.key]: val });
      onVolumeChange();
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
  for (const [value, label] of [
    ["en", "English"],
    ["ja", "日本語"],
  ] as const) {
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
    Bodies.rectangle(
      width - VISIBLE_EDGE + BUMPER_WIDTH / 2,
      height / 2,
      BUMPER_WIDTH,
      height,
      bumperOpts,
    ),
  ];
}

function createShopMenu(
  container: HTMLElement,
  counterEl: HTMLElement,
  onAddBall: () => void,
  onAddBumpers: () => void,
  onZigzag: () => void,
  onRebuildObstacles: () => void,
): void {
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
    if (visible) {
      row.hidden = !visible();
      conditionalRows.push({ row, visible });
    }
  }

  // Max balls upgrade
  const maxBallsRow = document.createElement("div");
  maxBallsRow.className = "shop-item";

  const maxBallsLabel = document.createElement("span");

  const maxBallsBtn = document.createElement("button");
  maxBallsBtn.className = "shop-buy-btn";
  maxBallsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    const cost = costOf("maxBalls", getLevel(s, "maxBalls"));
    if (s.collisionCount >= cost) {
      updateState({ collisionCount: s.collisionCount - cost, maxBalls: s.maxBalls + 1 });
      updateUpgrades({ maxBalls: s.upgrades.maxBalls + 1 });
      counterEl.textContent = String(getState().collisionCount);
    }
  });

  maxBallsRow.appendChild(maxBallsLabel);
  maxBallsRow.appendChild(maxBallsBtn);
  panel.appendChild(maxBallsRow);
  registerRow(maxBallsRow, () => getState().peakCoins >= revealAtOf("maxBalls"));

  // Restitution upgrade
  const restitutionRow = document.createElement("div");
  restitutionRow.className = "shop-item";

  const restitutionLabel = document.createElement("span");

  const restitutionBtn = document.createElement("button");
  restitutionBtn.className = "shop-buy-btn";
  restitutionBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    const cost = costOf("restitution", getLevel(s, "restitution"));
    if (s.collisionCount >= cost) {
      updateState({
        collisionCount: s.collisionCount - cost,
        ballRestitution: Math.round((s.ballRestitution + 0.05) * 100) / 100,
      });
      updateUpgrades({ restitution: s.upgrades.restitution + 1 });
      counterEl.textContent = String(getState().collisionCount);
    }
  });

  restitutionRow.appendChild(restitutionLabel);
  restitutionRow.appendChild(restitutionBtn);
  panel.appendChild(restitutionRow);
  registerRow(restitutionRow, () => getState().peakCoins >= revealAtOf("restitution"));

  // Auto drop upgrade
  const autoDropRow = document.createElement("div");
  autoDropRow.className = "shop-item";

  const autoDropLabel = document.createElement("span");

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
    const cost = costOf("autoDrop", getLevel(s, "autoDrop"));
    if (s.collisionCount >= cost && s.autoDropInterval !== AUTO_DROP_MIN_INTERVAL) {
      const newLevel = s.upgrades.autoDrop + 1;
      const newInterval = Math.max(AUTO_DROP_MIN_INTERVAL, 10000 - (newLevel - 1) * 1000);
      updateState({
        collisionCount: s.collisionCount - cost,
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
  registerRow(autoDropRow, () => getState().peakCoins >= revealAtOf("autoDrop"));

  // Resume auto drop from saved state
  const savedState = getState();
  if (savedState.autoDropInterval > 0) {
    startAutoDrop(savedState.autoDropInterval);
  }

  // Bounce multiplier upgrade
  const multiplierRow = document.createElement("div");
  multiplierRow.className = "shop-item";

  const multiplierLabel = document.createElement("span");

  const multiplierBtn = document.createElement("button");
  multiplierBtn.className = "shop-buy-btn";
  multiplierBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    const cost = costOf("bounceMultiplier", getLevel(s, "bounceMultiplier"));
    if (s.collisionCount >= cost && s.bounceMultiplier < MULTIPLIER_MAX) {
      const newMult = Math.min(MULTIPLIER_MAX, Math.round((s.bounceMultiplier + 0.05) * 100) / 100);
      updateState({
        collisionCount: s.collisionCount - cost,
        bounceMultiplier: newMult,
      });
      updateUpgrades({ bounceMultiplier: s.upgrades.bounceMultiplier + 1 });
      counterEl.textContent = String(getState().collisionCount);
    }
  });

  multiplierRow.appendChild(multiplierLabel);
  multiplierRow.appendChild(multiplierBtn);
  panel.appendChild(multiplierRow);
  registerRow(multiplierRow, () => getState().peakCoins >= revealAtOf("bounceMultiplier"));

  // Critical chance upgrade
  const criticalRow = document.createElement("div");
  criticalRow.className = "shop-item";

  const criticalLabel = document.createElement("span");

  const criticalBtn = document.createElement("button");
  criticalBtn.className = "shop-buy-btn";
  criticalBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    const cost = costOf("critical", getLevel(s, "critical"));
    if (s.collisionCount >= cost && s.criticalChance < CRITICAL_MAX_CHANCE) {
      const newChance = Math.min(
        CRITICAL_MAX_CHANCE,
        Math.round((s.criticalChance + 0.05) * 100) / 100,
      );
      updateState({
        collisionCount: s.collisionCount - cost,
        criticalChance: newChance,
      });
      updateUpgrades({ critical: s.upgrades.critical + 1 });
      counterEl.textContent = String(getState().collisionCount);
    }
  });

  criticalRow.appendChild(criticalLabel);
  criticalRow.appendChild(criticalBtn);
  panel.appendChild(criticalRow);
  registerRow(criticalRow, () => getState().peakCoins >= revealAtOf("critical"));

  // Multi drop upgrade
  const multiDropRow = document.createElement("div");
  multiDropRow.className = "shop-item";

  const multiDropLabel = document.createElement("span");

  const multiDropBtn = document.createElement("button");
  multiDropBtn.className = "shop-buy-btn";
  multiDropBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    const cost = costOf("multiDrop", getLevel(s, "multiDrop"));
    if (s.collisionCount >= cost) {
      updateState({
        collisionCount: s.collisionCount - cost,
        multiDrop: s.multiDrop + 1,
      });
      updateUpgrades({ multiDrop: s.upgrades.multiDrop + 1 });
      counterEl.textContent = String(getState().collisionCount);
    }
  });

  multiDropRow.appendChild(multiDropLabel);
  multiDropRow.appendChild(multiDropBtn);
  panel.appendChild(multiDropRow);
  registerRow(multiDropRow, () => getState().peakCoins >= revealAtOf("multiDrop"));

  // Expand rows upgrade
  const expandRowsRow = document.createElement("div");
  expandRowsRow.className = "shop-item";

  const expandRowsLabel = document.createElement("span");

  const expandRowsBtn = document.createElement("button");
  expandRowsBtn.className = "shop-buy-btn";
  expandRowsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    const cost = costOf("expandRows", getLevel(s, "expandRows"));
    if (s.collisionCount >= cost && s.expandRows < EXPAND_ROWS_MAX) {
      updateState({
        collisionCount: s.collisionCount - cost,
        expandRows: s.expandRows + 1,
      });
      counterEl.textContent = String(getState().collisionCount);
      onRebuildObstacles();
    }
  });

  expandRowsRow.appendChild(expandRowsLabel);
  expandRowsRow.appendChild(expandRowsBtn);
  panel.appendChild(expandRowsRow);
  registerRow(expandRowsRow, () => getState().peakCoins >= revealAtOf("expandRows"));

  // Expand columns upgrade
  const expandColsRow = document.createElement("div");
  expandColsRow.className = "shop-item";

  const expandColsLabel = document.createElement("span");

  const expandColsBtn = document.createElement("button");
  expandColsBtn.className = "shop-buy-btn";
  expandColsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    const cost = costOf("expandCols", getLevel(s, "expandCols"));
    if (s.collisionCount >= cost && s.expandCols < EXPAND_COLS_MAX) {
      updateState({
        collisionCount: s.collisionCount - cost,
        expandCols: s.expandCols + 1,
      });
      counterEl.textContent = String(getState().collisionCount);
      onRebuildObstacles();
    }
  });

  expandColsRow.appendChild(expandColsLabel);
  expandColsRow.appendChild(expandColsBtn);
  panel.appendChild(expandColsRow);
  registerRow(expandColsRow, () => getState().peakCoins >= revealAtOf("expandCols"));

  // Bumpers upgrade (one-time purchase)
  const bumperRow = document.createElement("div");
  bumperRow.className = "shop-item";

  const bumperLabel = document.createElement("span");

  const bumperBtn = document.createElement("button");
  bumperBtn.className = "shop-buy-btn";
  bumperBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    const cost = costOf("bumpers", getLevel(s, "bumpers"));
    if (s.collisionCount >= cost && !s.hasBumpers) {
      updateState({
        collisionCount: s.collisionCount - cost,
        hasBumpers: true,
      });
      counterEl.textContent = String(getState().collisionCount);
      onAddBumpers();
    }
  });

  bumperRow.appendChild(bumperLabel);
  bumperRow.appendChild(bumperBtn);
  panel.appendChild(bumperRow);
  registerRow(bumperRow, () => getState().peakCoins >= revealAtOf("bumpers"));

  // Zigzag upgrade (one-time purchase)
  const zigzagRow = document.createElement("div");
  zigzagRow.className = "shop-item";

  const zigzagLabel = document.createElement("span");

  const zigzagBtn = document.createElement("button");
  zigzagBtn.className = "shop-buy-btn";
  zigzagBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    const cost = costOf("zigzag", getLevel(s, "zigzag"));
    if (s.collisionCount >= cost && !s.hasZigzag) {
      updateState({
        collisionCount: s.collisionCount - cost,
        hasZigzag: true,
      });
      counterEl.textContent = String(getState().collisionCount);
      onZigzag();
    }
  });

  zigzagRow.appendChild(zigzagLabel);
  zigzagRow.appendChild(zigzagBtn);
  panel.appendChild(zigzagRow);
  registerRow(zigzagRow, () => getState().peakCoins >= revealAtOf("zigzag"));

  // Traits unlock (one-time)
  const traitsUnlockRow = document.createElement("div");
  traitsUnlockRow.className = "shop-item";

  const traitsUnlockLabel = document.createElement("span");

  const traitsUnlockBtn = document.createElement("button");
  traitsUnlockBtn.className = "shop-buy-btn";
  traitsUnlockBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    const cost = costOf("traitsUnlock", getLevel(s, "traitsUnlock"));
    if (s.collisionCount >= cost && !s.hasSpecialBalls) {
      updateState({
        collisionCount: s.collisionCount - cost,
        hasSpecialBalls: true,
      });
      counterEl.textContent = String(getState().collisionCount);
    }
  });

  traitsUnlockRow.appendChild(traitsUnlockLabel);
  traitsUnlockRow.appendChild(traitsUnlockBtn);
  panel.appendChild(traitsUnlockRow);
  registerRow(traitsUnlockRow, () => getState().peakCoins >= revealAtOf("traitsUnlock"));

  // Individual trait items
  type TraitKey = "big" | "premium" | "critical" | "life" | "split";
  const traitDefs: {
    key: TraitKey;
    labelKey: "traitBig" | "traitPremium" | "traitCritical" | "traitLife" | "traitSplit";
    upgradeId: "trait:big" | "trait:premium" | "trait:critical" | "trait:life" | "trait:split";
  }[] = [
    { key: "big", labelKey: "traitBig", upgradeId: "trait:big" },
    { key: "premium", labelKey: "traitPremium", upgradeId: "trait:premium" },
    { key: "critical", labelKey: "traitCritical", upgradeId: "trait:critical" },
    { key: "life", labelKey: "traitLife", upgradeId: "trait:life" },
    { key: "split", labelKey: "traitSplit", upgradeId: "trait:split" },
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
      const cost = costOf(def.upgradeId, getLevel(s, def.upgradeId));
      if (s.hasSpecialBalls && s.collisionCount >= cost) {
        updateState({ collisionCount: s.collisionCount - cost });
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
    // Toggle affordability classes on buyable (non-disabled) buttons so the
    // shop visually distinguishes what the player can act on right now.
    const setAffordance = (btn: HTMLButtonElement, cost: number): void => {
      if (btn.disabled) {
        btn.classList.remove("affordable", "unaffordable");
        return;
      }
      const ok = s.collisionCount >= cost;
      btn.classList.toggle("affordable", ok);
      btn.classList.toggle("unaffordable", !ok);
    };
    maxBallsLabel.textContent = `${t("maxBalls")}: ${s.maxBalls}`;
    const maxBallsCost = costOf("maxBalls", getLevel(s, "maxBalls"));
    maxBallsBtn.textContent = `+1 (${maxBallsCost})`;
    setAffordance(maxBallsBtn, maxBallsCost);
    restitutionLabel.textContent = `${t("restitution")}: ${s.ballRestitution.toFixed(2)}`;
    const restitutionCost = costOf("restitution", getLevel(s, "restitution"));
    restitutionBtn.textContent = `+0.05 (${restitutionCost})`;
    setAffordance(restitutionBtn, restitutionCost);
    if (s.autoDropInterval > 0) {
      autoDropLabel.textContent = `${t("autoDrop")}: ${(s.autoDropInterval / 1000).toFixed(1)}s`;
      if (s.autoDropInterval <= AUTO_DROP_MIN_INTERVAL) {
        autoDropBtn.textContent = t("max");
        autoDropBtn.disabled = true;
        setAffordance(autoDropBtn, 0);
      } else {
        const c = costOf("autoDrop", getLevel(s, "autoDrop"));
        autoDropBtn.textContent = `-1s (${c})`;
        autoDropBtn.disabled = false;
        setAffordance(autoDropBtn, c);
      }
    } else {
      autoDropLabel.textContent = `${t("autoDrop")}: ${t("off")}`;
      const c = costOf("autoDrop", getLevel(s, "autoDrop"));
      autoDropBtn.textContent = `${t("on")} (${c})`;
      autoDropBtn.disabled = false;
      setAffordance(autoDropBtn, c);
    }
    multiplierLabel.textContent = `${t("multiplier")}: x${s.bounceMultiplier.toFixed(2)}`;
    if (s.bounceMultiplier >= MULTIPLIER_MAX) {
      multiplierBtn.textContent = t("max");
      multiplierBtn.disabled = true;
      setAffordance(multiplierBtn, 0);
    } else {
      const c = costOf("bounceMultiplier", getLevel(s, "bounceMultiplier"));
      multiplierBtn.textContent = `+0.05 (${c})`;
      multiplierBtn.disabled = false;
      setAffordance(multiplierBtn, c);
    }
    criticalLabel.textContent = `${t("critical")}: ${Math.round(s.criticalChance * 100)}% (x${CRITICAL_BONUS})`;
    if (s.criticalChance >= CRITICAL_MAX_CHANCE) {
      criticalBtn.textContent = t("max");
      criticalBtn.disabled = true;
      setAffordance(criticalBtn, 0);
    } else {
      const c = costOf("critical", getLevel(s, "critical"));
      criticalBtn.textContent = `+5% (${c})`;
      criticalBtn.disabled = false;
      setAffordance(criticalBtn, c);
    }
    multiDropLabel.textContent = `${t("multiDrop")}: ${s.multiDrop}`;
    const multiDropCost = costOf("multiDrop", getLevel(s, "multiDrop"));
    multiDropBtn.textContent = `+1 (${multiDropCost})`;
    setAffordance(multiDropBtn, multiDropCost);
    const totalRows = 3 + s.expandRows * 2;
    expandRowsLabel.textContent = `${t("expandRows")}: ${totalRows}`;
    if (s.expandRows >= EXPAND_ROWS_MAX) {
      expandRowsBtn.textContent = t("max");
      expandRowsBtn.disabled = true;
      setAffordance(expandRowsBtn, 0);
    } else {
      const c = costOf("expandRows", getLevel(s, "expandRows"));
      expandRowsBtn.textContent = `+2 (${c})`;
      expandRowsBtn.disabled = false;
      setAffordance(expandRowsBtn, c);
    }
    const totalCols = 3 + s.expandCols * 2;
    expandColsLabel.textContent = `${t("expandCols")}: ${totalCols}`;
    if (s.expandCols >= EXPAND_COLS_MAX) {
      expandColsBtn.textContent = t("max");
      expandColsBtn.disabled = true;
      setAffordance(expandColsBtn, 0);
    } else {
      const c = costOf("expandCols", getLevel(s, "expandCols"));
      expandColsBtn.textContent = `+2 (${c})`;
      expandColsBtn.disabled = false;
      setAffordance(expandColsBtn, c);
    }
    if (s.hasBumpers) {
      bumperLabel.textContent = `${t("bumpers")}: ${t("on")}`;
      bumperBtn.textContent = t("purchased");
      bumperBtn.disabled = true;
      setAffordance(bumperBtn, 0);
    } else {
      bumperLabel.textContent = `${t("bumpers")}: ${t("off")}`;
      const c = costOf("bumpers", getLevel(s, "bumpers"));
      bumperBtn.textContent = `${t("buy")} (${c})`;
      setAffordance(bumperBtn, c);
    }
    if (s.hasZigzag) {
      zigzagLabel.textContent = `${t("zigzag")}: ${t("on")}`;
      zigzagBtn.textContent = t("purchased");
      zigzagBtn.disabled = true;
      setAffordance(zigzagBtn, 0);
    } else {
      zigzagLabel.textContent = `${t("zigzag")}: ${t("off")}`;
      const c = costOf("zigzag", getLevel(s, "zigzag"));
      zigzagBtn.textContent = `${t("buy")} (${c})`;
      setAffordance(zigzagBtn, c);
    }
    // Traits
    if (s.hasSpecialBalls) {
      traitsUnlockLabel.textContent = `${t("traits")}: ${t("on")}`;
      traitsUnlockBtn.textContent = t("purchased");
      traitsUnlockBtn.disabled = true;
      setAffordance(traitsUnlockBtn, 0);
      for (let i = 0; i < traitDefs.length; i++) {
        const def = traitDefs[i];
        const count = s.specialBalls[def.key];
        const pct = Math.min(Math.round(count * TRAIT_CHANCE_PER_LEVEL * 100), 100);
        traitLabels[i].textContent = `${t(def.labelKey)}: ${pct}%`;
        if (pct >= 100) {
          traitBtns[i].textContent = t("max");
          traitBtns[i].disabled = true;
          setAffordance(traitBtns[i], 0);
        } else {
          const c = costOf(def.upgradeId, getLevel(s, def.upgradeId));
          traitBtns[i].textContent = `+10% (${c})`;
          traitBtns[i].disabled = false;
          setAffordance(traitBtns[i], c);
        }
      }
    } else {
      traitsUnlockLabel.textContent = `${t("traits")}: ${t("off")}`;
      const c = costOf("traitsUnlock", getLevel(s, "traitsUnlock"));
      traitsUnlockBtn.textContent = `${t("unlock")} (${c})`;
      setAffordance(traitsUnlockBtn, c);
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

function showFloatText(
  container: HTMLElement,
  x: number,
  y: number,
  amount: number,
  critical: boolean,
): void {
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
  let obstacles = createObstacles(
    width,
    height,
    getState().hasZigzag,
    getState().expandRows,
    getState().expandCols,
  );
  Composite.add(engine.world, obstacles);

  // Track active balls and their metadata
  const balls = new Map<number, Matter.Body>();
  const ballMeta = new Map<number, BallMeta>();

  function parentBallCount(): number {
    let c = 0;
    for (const meta of ballMeta.values()) if (!meta.isChild) c++;
    return c;
  }

  function addBall(x: number, angleDeg = 0): void {
    const traits = rollTraits();
    const ball = createBall(x, traits);
    balls.set(ball.id, ball);
    ballMeta.set(ball.id, {
      value: traits.has("premium") ? 3 : 1,
      traits,
      lives: traits.has("life") ? 1 : 0,
      splitAngle: Math.random() * Math.PI * 2,
      isChild: false,
    });
    if (angleDeg !== 0) {
      const rad = (angleDeg * Math.PI) / 180;
      Body.setVelocity(ball, { x: Math.sin(rad) * 5, y: Math.cos(rad) * 5 });
    }
    Composite.add(engine.world, ball);
  }

  function spawnChildBall(x: number, y: number, value: number): void {
    const ball = createBall(x, new Set());
    Body.setPosition(ball, { x, y });
    balls.set(ball.id, ball);
    ballMeta.set(ball.id, {
      value,
      traits: new Set(),
      lives: 0,
      splitAngle: 0,
      isChild: true,
    });
    Composite.add(engine.world, ball);
  }

  const effectQueue = new EffectQueue();

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
          effectQueue.add(createRespawnStreak(ball.position.x, height));
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

  // Overlay pass: trait effects then transient effects
  Events.on(render, "afterRender", () => {
    const ctx = render.context;
    renderBallTraits(ctx, balls, ballMeta);
    effectQueue.render(ctx);
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
        // Split trait: chance to spawn a plain child ball inheriting parent's value
        if (meta?.traits.has("split") && Math.random() < SPLIT_SPAWN_CHANCE) {
          spawnChildBall(ball.position.x, ball.position.y, ballValue);
          const r = ball.circleRadius ?? BALL_RADIUS;
          effectQueue.add(createSplitBurst(ball.position.x, ball.position.y, r));
        }
        counterEl.textContent = String(getState().collisionCount);
      }
    }
  });

  // Drop multiple balls respecting max limit
  function dropBalls(baseX: number, spread: boolean, angleDeg = 0): void {
    const s = getState();
    for (let i = 0; i < s.multiDrop && parentBallCount() < s.maxBalls; i++) {
      const x = spread ? baseX + (i - (s.multiDrop - 1) / 2) * (BALL_RADIUS * 8) : baseX;
      addBall(x, angleDeg);
    }
  }

  // Click to drop ball — convert screen coords to logical coords
  canvas.addEventListener("click", (e) => {
    if (parentBallCount() < getState().maxBalls) {
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

  createShopMenu(
    container,
    counterEl,
    () => {
      // Drop within the current obstacle cluster width (+1 cell of margin)
      // so auto-drop stays effective without buying column expansions.
      const cols = 3 + getState().expandCols * 2 + 1;
      const rangeWidth = cols * GRID_SIZE;
      const minX = width / 2 - rangeWidth / 2;
      // Random ±30° tilt avoids straight-through drops that miss every obstacle.
      const angleDeg = (Math.random() * 2 - 1) * 30;
      dropBalls(minX + Math.random() * rangeWidth, true, angleDeg);
    },
    addBumpers,
    rebuildObstacles,
    rebuildObstacles,
  );

  // Centralized volume application — respects mute flag
  function applyVolumes(): void {
    const s = getState();
    if (s.muted) {
      setKickVolume(-Infinity);
      setHihatVolume(-Infinity);
      setSynthVolume(-Infinity);
    } else {
      setKickVolume(s.volume.kick <= -30 ? -Infinity : s.volume.kick);
      setHihatVolume(s.volume.hihat <= -30 ? -Infinity : s.volume.hihat);
      setSynthVolume(s.volume.synth <= -30 ? -Infinity : s.volume.synth);
    }
  }

  applyVolumes();

  // Mute toggle button (top-right, next to hamburger)
  const muteBtn = document.createElement("button");
  muteBtn.id = "mute-btn";
  muteBtn.textContent = getState().muted ? "\u{1F507}" : "\u{1F50A}";

  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const newMuted = !getState().muted;
    updateState({ muted: newMuted });
    muteBtn.textContent = newMuted ? "\u{1F507}" : "\u{1F50A}";
    applyVolumes();
  });

  container.appendChild(muteBtn);

  // Settings menu
  const settingsMenu = createSettingsMenu(container, applyVolumes);

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
