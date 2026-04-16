import Matter from "matter-js";
import { play, getDuration, setKickVolume, setHihatVolume, setSynthVolume } from "./synth";
import { getState, updateState, updateUpgrades, updateVolume, onChange } from "./state";

const { Engine, Render, Runner, Body, Bodies, Composite, Events } = Matter;

const GRID_SIZE = 100;
const BALL_RADIUS = 10;
const WALL_COLOR = "#4a4a6a";
const FLASH_COLOR = "#ffffff";
const FLASH_DURATION = 150;

function createObstacles(width: number, height: number): Matter.Body[] {
  const bodies: Matter.Body[] = [];
  const cols = Math.ceil(width / GRID_SIZE);
  const rows = Math.ceil(height / GRID_SIZE);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x = gx * GRID_SIZE + GRID_SIZE / 2;
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

function createSettingsMenu(): HTMLElement {
  const menu = document.createElement("div");
  menu.id = "settings-menu";
  menu.hidden = true;

  const state = getState();
  const sliders: { label: string; key: keyof typeof state.volume; setFn: (db: number) => void }[] = [
    { label: "Kick", key: "kick", setFn: setKickVolume },
    { label: "Hi-Hat", key: "hihat", setFn: setHihatVolume },
    { label: "Synth", key: "synth", setFn: setSynthVolume },
  ];

  for (const s of sliders) {
    const row = document.createElement("div");
    row.className = "settings-row";

    const label = document.createElement("label");
    label.textContent = s.label;

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

  document.body.appendChild(menu);
  return menu;
}

function createShopMenu(counterEl: HTMLElement, onAddBall: () => void): void {
  const btn = document.createElement("button");
  btn.id = "hamburger-btn";
  btn.innerHTML = "&#9776;";
  document.body.appendChild(btn);

  const panel = document.createElement("div");
  panel.id = "shop-panel";

  const title = document.createElement("h3");
  title.className = "shop-title";
  title.textContent = "Shop";
  panel.appendChild(title);

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

  // Update labels on state change
  const refreshLabels = () => {
    const s = getState();
    maxBallsLabel.textContent = `Max Balls: ${s.maxBalls}`;
    restitutionLabel.textContent = `Restitution: ${s.ballRestitution.toFixed(2)}`;
    if (s.autoDropInterval > 0) {
      autoDropLabel.textContent = `Auto Drop: ${(s.autoDropInterval / 1000).toFixed(1)}s`;
      autoDropBtn.textContent = s.autoDropInterval <= AUTO_DROP_MIN_INTERVAL
        ? "MAX"
        : `-0.2s (${autoDropCost})`;
      autoDropBtn.disabled = s.autoDropInterval <= AUTO_DROP_MIN_INTERVAL;
    } else {
      autoDropLabel.textContent = "Auto Drop: OFF";
      autoDropBtn.textContent = `ON (${autoDropCost})`;
    }
    multiplierLabel.textContent = `Multiplier: x${s.collisionMultiplier}`;
  };
  onChange(refreshLabels);
  refreshLabels();

  document.body.appendChild(panel);

  let open = false;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    open = !open;
    panel.classList.toggle("open", open);
  });
}

function showFloatText(x: number, y: number, amount: number): void {
  const el = document.createElement("div");
  el.className = "float-text";
  el.textContent = `+${amount}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

export function createWorld(canvas: HTMLCanvasElement): void {
  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.width = width;
  canvas.height = height;

  // Counter display
  const counterEl = document.createElement("div");
  counterEl.id = "counter";
  counterEl.textContent = String(getState().collisionCount);
  document.body.appendChild(counterEl);

  const engine = Engine.create();
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
  const obstacles = createObstacles(width, height);
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

        // Show floating text and increment counter with multiplier
        const mult = getState().collisionMultiplier;
        showFloatText(ball.position.x, ball.position.y, mult);
        updateState({ collisionCount: getState().collisionCount + mult });
        counterEl.textContent = String(getState().collisionCount);
      }
    }
  });

  // Click to drop ball (respects max)
  canvas.addEventListener("click", (e) => {
    if (balls.size < getState().maxBalls) {
      addBall(e.clientX);
    }
  });

  // Start
  Render.run(render);
  const runner = Runner.create();
  Runner.run(runner, engine);

  // Shop menu
  createShopMenu(counterEl, () => {
    if (balls.size < getState().maxBalls) {
      addBall(Math.random() * width);
    }
  });

  // Apply saved volume on init
  const vol = getState().volume;
  setKickVolume(vol.kick <= -30 ? -Infinity : vol.kick);
  setHihatVolume(vol.hihat <= -30 ? -Infinity : vol.hihat);
  setSynthVolume(vol.synth <= -30 ? -Infinity : vol.synth);

  // Settings menu
  const settingsMenu = createSettingsMenu();

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
