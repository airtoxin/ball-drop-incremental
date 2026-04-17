import type Matter from "matter-js";

// ---------- Ball visual constants ----------
export const BALL_RADIUS = 10;
export const BIG_RADIUS_MULT = 2;
export const BALL_COLOR = "#cccccc";

// ---------- Trait types ----------
export type BallTrait = "big" | "premium" | "critical" | "life" | "split";

export const ALL_TRAITS: BallTrait[] = ["big", "premium", "critical", "life", "split"];

export interface BallMeta {
  value: number;
  traits: Set<BallTrait>;
  lives: number;
  splitAngle: number;
  isChild: boolean;
  // Instrumentation: collision count accumulated over this ball's lifetime, and
  // the throw (single player action) it belongs to. Split-spawned children
  // inherit the parent's throwId so per-throw stats lump them together.
  hits: number;
  throwId: number;
}

// ---------- Trait overlay renderers ----------
// Each trait may register a renderer that draws on top of the Matter.js ball.
// Register new traits here and their rendering logic stays local to this file.

interface TraitRenderContext {
  ctx: CanvasRenderingContext2D;
  ball: Matter.Body;
  meta: BallMeta;
  time: number;
}

type TraitRenderer = (c: TraitRenderContext) => void;

function drawPremium({ ctx, ball }: TraitRenderContext): void {
  const { x, y } = ball.position;
  const r = ball.circleRadius ?? BALL_RADIUS;
  const auraR = r * 2.0;
  const grad = ctx.createRadialGradient(x, y, r * 0.8, x, y, auraR);
  grad.addColorStop(0, "rgba(255,215,0,0.32)");
  grad.addColorStop(1, "rgba(255,215,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, auraR, 0, Math.PI * 2);
  ctx.fill();
}

function drawCritical({ ctx, ball }: TraitRenderContext): void {
  const { x, y } = ball.position;
  const r = ball.circleRadius ?? BALL_RADIUS;
  const rotation = ball.angle;
  const spikes = 10;
  const baseR = r;
  const tipR = r * 1.4;
  const baseHalfAngle = (Math.PI / spikes) * 0.4;
  ctx.fillStyle = "#ff5555";
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 + rotation;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a - baseHalfAngle) * baseR, y + Math.sin(a - baseHalfAngle) * baseR);
    ctx.lineTo(x + Math.cos(a) * tipR, y + Math.sin(a) * tipR);
    ctx.lineTo(x + Math.cos(a + baseHalfAngle) * baseR, y + Math.sin(a + baseHalfAngle) * baseR);
    ctx.closePath();
    ctx.fill();
  }
}

function drawLife({ ctx, ball, meta }: TraitRenderContext): void {
  if (meta.lives <= 0) return;
  const { x, y } = ball.position;
  const r = ball.circleRadius ?? BALL_RADIUS;
  ctx.strokeStyle = "rgba(80,255,120,0.75)";
  ctx.lineWidth = Math.max(1, r * 0.1);
  for (let i = 0; i < meta.lives; i++) {
    const ringR = r * (1.3 + i * 0.35);
    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawSplit({ ctx, ball, meta }: TraitRenderContext): void {
  const { x, y } = ball.position;
  const r = ball.circleRadius ?? BALL_RADIUS;
  const angle = meta.splitAngle + ball.angle;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const nx = -dy;
  const ny = dx;
  const ax = x - dx * r;
  const ay = y - dy * r;
  const bx = x + dx * r;
  const by = y + dy * r;
  const pinch = r * 0.18;
  ctx.strokeStyle = "#333333";
  ctx.lineWidth = Math.max(1.5, r * 0.22);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo(x + nx * pinch, y + ny * pinch, bx, by);
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo(x - nx * pinch, y - ny * pinch, bx, by);
  ctx.stroke();
}

const traitRenderers: Partial<Record<BallTrait, TraitRenderer>> = {
  premium: drawPremium,
  critical: drawCritical,
  life: drawLife,
  split: drawSplit,
  // big has no overlay — size is the indicator.
};

// Back-to-front draw order. Traits earlier in the list are drawn first.
const TRAIT_RENDER_ORDER: BallTrait[] = ["premium", "life", "critical", "split", "big"];

export function renderBallTraits(
  ctx: CanvasRenderingContext2D,
  balls: Map<number, Matter.Body>,
  ballMeta: Map<number, BallMeta>,
): void {
  const time = performance.now();
  for (const [id, ball] of balls) {
    const meta = ballMeta.get(id);
    if (!meta || meta.traits.size === 0) continue;
    for (const trait of TRAIT_RENDER_ORDER) {
      if (!meta.traits.has(trait)) continue;
      traitRenderers[trait]?.({ ctx, ball, meta, time });
    }
  }
}

// ---------- Transient effect queue ----------
// One-shot, time-bound effects (screen flashes, streaks, impact bursts, etc).
// Each effect's `update` is called every frame; return false to auto-remove.

export interface EffectUpdateContext {
  ctx: CanvasRenderingContext2D;
  time: number;
}

export interface Effect {
  update(c: EffectUpdateContext): boolean;
}

export class EffectQueue {
  private effects: Effect[] = [];

  add(effect: Effect): void {
    this.effects.push(effect);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const time = performance.now();
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (!this.effects[i].update({ ctx, time })) {
        this.effects.splice(i, 1);
      }
    }
  }
}

// ---------- Transient effect factories ----------

export function createSplitBurst(x: number, y: number, r: number): Effect {
  const start = performance.now();
  const DURATION = 280;
  const PARTICLE_COUNT = 6;
  const startAngle = Math.random() * Math.PI * 2;
  return {
    update({ ctx, time }) {
      const t = (time - start) / DURATION;
      if (t >= 1) return false;
      const alpha = 1 - t;
      const partR = r * (1.1 + t * 3.5);
      ctx.fillStyle = `rgba(200,200,200,${alpha})`;
      const partSize = Math.max(1, r * 0.3 * (1 - t));
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const a = startAngle + (i / PARTICLE_COUNT) * Math.PI * 2;
        const px = x + Math.cos(a) * partR;
        const py = y + Math.sin(a) * partR;
        ctx.beginPath();
        ctx.arc(px, py, partSize, 0, Math.PI * 2);
        ctx.fill();
      }
      return true;
    },
  };
}

export function createRespawnStreak(x: number, worldHeight: number): Effect {
  const start = performance.now();
  const DURATION = 140;
  const TRAIL = 320;
  return {
    update({ ctx, time }) {
      const elapsed = time - start;
      const t = elapsed / DURATION;
      if (t >= 1) return false;
      const headY = worldHeight - (worldHeight + TRAIL) * t;
      const tailY = headY + TRAIL;
      const visTop = Math.max(headY, 0);
      const visBot = Math.min(tailY, worldHeight);
      if (visBot > visTop) {
        const coreW = BALL_RADIUS * 1.2;
        const glowW = BALL_RADIUS * 5;
        const glowGrad = ctx.createLinearGradient(0, tailY, 0, headY);
        glowGrad.addColorStop(0, "rgba(80,255,120,0)");
        glowGrad.addColorStop(1, "rgba(80,255,120,0.45)");
        ctx.fillStyle = glowGrad;
        ctx.fillRect(x - glowW / 2, visTop, glowW, visBot - visTop);
        const coreGrad = ctx.createLinearGradient(0, tailY, 0, headY);
        coreGrad.addColorStop(0, "rgba(160,255,180,0)");
        coreGrad.addColorStop(1, "rgba(220,255,220,1)");
        ctx.fillStyle = coreGrad;
        ctx.fillRect(x - coreW / 2, visTop, coreW, visBot - visTop);
      }
      if (headY >= 0 && headY <= worldHeight) {
        const headR = BALL_RADIUS * 1.6;
        const headGrad = ctx.createRadialGradient(x, headY, 0, x, headY, headR);
        headGrad.addColorStop(0, "rgba(240,255,230,1)");
        headGrad.addColorStop(1, "rgba(80,255,120,0)");
        ctx.fillStyle = headGrad;
        ctx.beginPath();
        ctx.arc(x, headY, headR, 0, Math.PI * 2);
        ctx.fill();
      }
      return true;
    },
  };
}
