import Matter from "matter-js";
import { play, getDuration } from "./synth";

const { Engine, Render, Runner, Bodies, Composite, Events } = Matter;

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

      const body =
        (gx + gy) % 4 === 0
          ? Bodies.circle(x, y, GRID_SIZE / 5, opts)
          : Bodies.polygon(x, y, 3, GRID_SIZE / 4, opts);

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

  // Escape key toggles pause
  let paused = false;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      paused = !paused;
      runner.enabled = !paused;
    }
  });
}
