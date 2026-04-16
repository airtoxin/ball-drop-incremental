import Matter from "matter-js";
import { play, getDuration } from "./synth";

const { Engine, Render, Runner, Bodies, Composite, Events, Mouse, MouseConstraint } = Matter;

const GRID_SIZE = 100;
const BALL_RADIUS = 10;
const BALL_RESTITUTION = 0.9;
const BALL_COUNT = 4;

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

function createBall(width: number): Matter.Body {
  const x = width / 4 + (Math.random() * width) / 2;
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

export function createWorld(canvas: HTMLCanvasElement): void {
  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.width = width;
  canvas.height = height;

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

  function addBall(): void {
    const ball = createBall(width);
    balls.set(ball.id, ball);
    Composite.add(engine.world, ball);
  }

  // Spawn initial balls
  for (let i = 0; i < BALL_COUNT; i++) {
    setTimeout(() => addBall(), i * 500);
  }

  // Remove off-screen balls and respawn
  Events.on(engine, "afterUpdate", () => {
    for (const [id, ball] of balls) {
      const { min } = ball.bounds;
      if (min.y > height || min.x < 0 || min.x > width) {
        balls.delete(id);
        Composite.remove(engine.world, ball);
        addBall();
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
      const isWall = bodyA.isStatic || bodyB.isStatic;

      if (ball && isWall) {
        const duration = ball.label.split("ball_")[1];
        const velocity = ball.speed > 10 ? 1 : ball.speed / 10;
        play(duration, velocity);
      }
    }
  });

  // Mouse interaction
  const mouse = Mouse.create(render.canvas);
  const mouseConstraint = MouseConstraint.create(engine, {
    mouse,
    constraint: {
      stiffness: 0.2,
      render: { visible: false },
    },
  });
  Composite.add(engine.world, mouseConstraint);
  render.mouse = mouse;

  // Start
  Render.run(render);
  Runner.run(Runner.create(), engine);
}
