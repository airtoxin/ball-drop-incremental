import Matter from "matter-js";
import { play, getDuration, setKickVolume, setHihatVolume, setSynthVolume } from "./synth";

const { Engine, Render, Runner, Body, Bodies, Composite, Events } = Matter;

const GRID_SIZE = 100;
const BALL_RADIUS = 10;
const BALL_RESTITUTION = 0.9;
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
    restitution: BALL_RESTITUTION,
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

  const sliders: { label: string; value: number; onChange: (db: number) => void }[] = [
    { label: "Kick", value: -4, onChange: setKickVolume },
    { label: "Hi-Hat", value: -10, onChange: setHihatVolume },
    { label: "Synth", value: -8, onChange: setSynthVolume },
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
    input.value = String(s.value);
    input.addEventListener("input", () => {
      const val = Number(input.value);
      s.onChange(val <= -30 ? -Infinity : val);
    });

    row.appendChild(label);
    row.appendChild(input);
    menu.appendChild(row);
  }

  document.body.appendChild(menu);
  return menu;
}

function createShopMenu(): { toggle: () => void; isOpen: () => boolean } {
  const btn = document.createElement("button");
  btn.id = "hamburger-btn";
  btn.innerHTML = "&#9776;";
  document.body.appendChild(btn);

  const panel = document.createElement("div");
  panel.id = "shop-panel";
  document.body.appendChild(panel);

  let open = false;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    open = !open;
    panel.classList.toggle("open", open);
  });

  return {
    toggle: () => {
      open = !open;
      panel.classList.toggle("open", open);
    },
    isOpen: () => open,
  };
}

function showFloatText(x: number, y: number): void {
  const el = document.createElement("div");
  el.className = "float-text";
  el.textContent = "+1";
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

  // Collision counter
  let collisionCount = 0;
  const counterEl = document.createElement("div");
  counterEl.id = "counter";
  counterEl.textContent = "0";
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

        // Show +1 floating text and increment counter
        showFloatText(ball.position.x, ball.position.y);
        collisionCount++;
        counterEl.textContent = String(collisionCount);
      }
    }
  });

  // Click to drop ball
  canvas.addEventListener("click", (e) => {
    addBall(e.clientX);
  });

  // Start
  Render.run(render);
  const runner = Runner.create();
  Runner.run(runner, engine);

  // Shop menu
  createShopMenu();

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
