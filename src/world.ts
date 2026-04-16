import Matter from "matter-js";
import { play, getDuration, setKickVolume, setHihatVolume, setSynthVolume } from "./synth";
import { getState, updateState, updateUpgrades, updateVolume, onChange } from "./state";
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

function createObstacles(width: number, height: number, zigzag: boolean): Matter.Body[] {
  const bodies: Matter.Body[] = [];
  const MARGIN_X = GRID_SIZE * 2; // keep 2 columns clear on each side
  const MARGIN_Y = GRID_SIZE * 2; // keep 2 rows clear on top and bottom
  const cols = Math.ceil(width / GRID_SIZE);
  const rows = Math.ceil(height / GRID_SIZE);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const offset = zigzag && gy % 2 === 1 ? GRID_SIZE / 2 : 0;
      const x = gx * GRID_SIZE + GRID_SIZE / 2 + offset;
      const y = gy * GRID_SIZE + GRID_SIZE / 2;
      if (x < MARGIN_X || x > width - MARGIN_X) continue;
      if (y < MARGIN_Y || y > height - MARGIN_Y) continue;
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

function createBall(x: number): Matter.Body {
  return Bodies.circle(x, 0, BALL_RADIUS, {
    label: `ball_${getDuration()}`,
    restitution: getState().ballRestitution,
    friction: 0,
    density: 1000,
    render: {
      fillStyle: `hsl(${Math.random() * 360}, 70%, 60%)`,
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

  // Update labels on locale change
  onLocaleChange(() => {
    for (let i = 0; i < sliders.length; i++) {
      sliderLabels[i].textContent = t(sliders[i].labelKey);
    }
    langLabel.textContent = t("language");
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
  return [
    Bodies.rectangle(-BUMPER_WIDTH / 2, height / 2, BUMPER_WIDTH, height, bumperOpts),
    Bodies.rectangle(width + BUMPER_WIDTH / 2, height / 2, BUMPER_WIDTH, height, bumperOpts),
  ];
}

function createShopMenu(container: HTMLElement, counterEl: HTMLElement, onAddBall: () => void, onAddBumpers: () => void, onZigzag: () => void): void {
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
  const AUTO_DROP_BASE_INTERVAL = 3000;
  const AUTO_DROP_MIN_INTERVAL = 200;

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
        AUTO_DROP_BASE_INTERVAL - (newLevel - 1) * 200,
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

  // Collision multiplier upgrade
  const multiplierRow = document.createElement("div");
  multiplierRow.className = "shop-item";

  const multiplierLabel = document.createElement("span");
  const multiplierCost = 500;

  const multiplierBtn = document.createElement("button");
  multiplierBtn.className = "shop-buy-btn";
  multiplierBtn.textContent = `+1 (${multiplierCost})`;
  multiplierBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = getState();
    if (s.collisionCount >= multiplierCost) {
      updateState({
        collisionCount: s.collisionCount - multiplierCost,
        collisionMultiplier: s.collisionMultiplier + 1,
      });
      updateUpgrades({ collisionMultiplier: s.upgrades.collisionMultiplier + 1 });
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

  // Update labels on state change
  const refreshLabels = () => {
    const s = getState();
    maxBallsLabel.textContent = `${t("maxBalls")}: ${s.maxBalls}`;
    restitutionLabel.textContent = `${t("restitution")}: ${s.ballRestitution.toFixed(2)}`;
    if (s.autoDropInterval > 0) {
      autoDropLabel.textContent = `${t("autoDrop")}: ${(s.autoDropInterval / 1000).toFixed(1)}s`;
      autoDropBtn.textContent = s.autoDropInterval <= AUTO_DROP_MIN_INTERVAL
        ? t("max")
        : `-0.2s (${autoDropCost})`;
      autoDropBtn.disabled = s.autoDropInterval <= AUTO_DROP_MIN_INTERVAL;
    } else {
      autoDropLabel.textContent = `${t("autoDrop")}: ${t("off")}`;
      autoDropBtn.textContent = `${t("on")} (${autoDropCost})`;
    }
    multiplierLabel.textContent = `${t("multiplier")}: x${s.collisionMultiplier}`;
    if (s.criticalChance >= CRITICAL_MAX_CHANCE) {
      criticalLabel.textContent = `${t("critical")}: ${Math.round(s.criticalChance * 100)}% (x${CRITICAL_BONUS})`;
      criticalBtn.textContent = t("max");
      criticalBtn.disabled = true;
    } else {
      criticalLabel.textContent = `${t("critical")}: ${Math.round(s.criticalChance * 100)}% (x${CRITICAL_BONUS})`;
      criticalBtn.textContent = `+5% (${criticalCost})`;
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
  let obstacles = createObstacles(width, height, getState().hasZigzag);
  Composite.add(engine.world, obstacles);

  // Track active balls
  const balls = new Map<number, Matter.Body>();

  function addBall(x: number): void {
    const ball = createBall(x);
    balls.set(ball.id, ball);
    Composite.add(engine.world, ball);
  }

  // Remove off-screen balls
  Events.on(engine, "afterUpdate", () => {
    for (const [id, ball] of balls) {
      const { min } = ball.bounds;
      if (min.y > height || min.x < 0 || min.x > width) {
        balls.delete(id);
        Composite.remove(engine.world, ball);
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

        // Show floating text and increment counter with multiplier + critical
        const s = getState();
        const isCritical = s.criticalChance > 0 && Math.random() < s.criticalChance;
        const amount = isCritical ? s.collisionMultiplier * 5 : s.collisionMultiplier;
        showFloatText(container, ball.position.x, ball.position.y, amount, isCritical);
        updateState({ collisionCount: s.collisionCount + amount });
        counterEl.textContent = String(getState().collisionCount);
      }
    }
  });

  // Click to drop ball — convert screen coords to logical coords
  canvas.addEventListener("click", (e) => {
    if (balls.size < getState().maxBalls) {
      const rect = canvas.getBoundingClientRect();
      const logicalX = ((e.clientX - rect.left) / rect.width) * width;
      addBall(logicalX);
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
  createShopMenu(container, counterEl, () => {
    if (balls.size < getState().maxBalls) {
      addBall(Math.random() * width);
    }
  }, addBumpers, () => {
    // Replace obstacles with zigzag layout
    for (const ob of obstacles) {
      Composite.remove(engine.world, ob);
    }
    obstacles = createObstacles(width, height, true);
    Composite.add(engine.world, obstacles);
  });

  // Apply saved volume on init
  const vol = getState().volume;
  setKickVolume(vol.kick <= -30 ? -Infinity : vol.kick);
  setHihatVolume(vol.hihat <= -30 ? -Infinity : vol.hihat);
  setSynthVolume(vol.synth <= -30 ? -Infinity : vol.synth);

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
