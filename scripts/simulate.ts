// Economy tuning simulator.
//
// Runs N stochastic buy-strategy simulations and reports aggregate statistics
// (median / p10 / p90) at fixed time checkpoints, so you can see whether a
// costGrowth change produces a gentle curve or a stall cliff across strategies.
//
// Usage:
//   vp dlx tsx scripts/simulate.ts
//   vp dlx tsx scripts/simulate.ts --strategy bang --epsilon 0.2 --runs 30
//   vp dlx tsx scripts/simulate.ts --runs 1 --strategy greedy     # detailed single run
//
// Flags:
//   --strategy S      greedy | bang | epsilon-greedy | epsilon-bang (default: epsilon-bang)
//   --epsilon F       exploration rate for epsilon-* strategies (default: 0.15)
//   --runs N          number of independent runs (default: 20). 1 prints per-purchase log.
//   --seed N          base seed (default: 1). Run k uses seed + k.
//   --hits N          average hits per ball life (default: 15)
//   --manual R        manual drops/sec (default: 0)
//   --ball-lifetime S average ball lifetime in seconds (default: 5)
//   --max-hours H     cap sim time (default: 2)
//   --dt S            tick length in seconds for income advancement (default: 1)
//   --start-coins N   starting collisionCount (default: 0)

import {
  ALL_UPGRADE_IDS,
  applyPurchase,
  costOf,
  getLevel,
  incomePerSec,
  isMaxed,
  type IncomeParams,
  type UpgradeId,
} from "../src/economy";
import { defaults } from "../src/state";
import type { SaveData } from "../src/state";

declare const process: { argv: string[] };

// ---------- CLI ----------

type StrategyName = "greedy" | "bang" | "epsilon-greedy" | "epsilon-bang";

interface CliArgs {
  strategy: StrategyName;
  epsilon: number;
  runs: number;
  seed: number;
  hits: number;
  manual: number;
  ballLifetime: number;
  maxHours: number;
  dt: number;
  startCoins: number;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    strategy: "epsilon-bang",
    epsilon: 0.15,
    runs: 20,
    seed: 1,
    hits: 15,
    manual: 0,
    ballLifetime: 5,
    maxHours: 2,
    dt: 1,
    startCoins: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--strategy":
        out.strategy = next as StrategyName;
        i++;
        break;
      case "--epsilon":
        out.epsilon = Number(next);
        i++;
        break;
      case "--runs":
        out.runs = Number(next);
        i++;
        break;
      case "--seed":
        out.seed = Number(next);
        i++;
        break;
      case "--hits":
        out.hits = Number(next);
        i++;
        break;
      case "--manual":
        out.manual = Number(next);
        i++;
        break;
      case "--ball-lifetime":
        out.ballLifetime = Number(next);
        i++;
        break;
      case "--max-hours":
        out.maxHours = Number(next);
        i++;
        break;
      case "--dt":
        out.dt = Number(next);
        i++;
        break;
      case "--start-coins":
        out.startCoins = Number(next);
        i++;
        break;
    }
  }
  return out;
}

// ---------- Deterministic RNG ----------
// mulberry32: tiny, seedable, good enough for tuning.

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Strategies ----------

type Strategy = (
  state: Readonly<SaveData>,
  params: IncomeParams,
  rng: () => number,
) => UpgradeId | null;

function affordable(state: Readonly<SaveData>): UpgradeId[] {
  const out: UpgradeId[] = [];
  for (const id of ALL_UPGRADE_IDS) {
    const level = getLevel(state, id);
    if (isMaxed(id, level)) continue;
    if (costOf(id, level) > state.collisionCount) continue;
    out.push(id);
  }
  return out;
}

const greedyCheapest: Strategy = (state) => {
  let best: { id: UpgradeId; cost: number } | null = null;
  for (const id of affordable(state)) {
    const cost = costOf(id, getLevel(state, id));
    if (best == null || cost < best.cost) best = { id, cost };
  }
  return best?.id ?? null;
};

// Maximize Δincome per cost. Layout / one-shot upgrades that don't move the
// analytic income curve score 0 and are deprioritized — exploration (epsilon)
// is what lets them still get bought.
const bangPerBuck: Strategy = (state, params) => {
  const baseInc = incomePerSec(state, params);
  let best: { id: UpgradeId; score: number } | null = null;
  for (const id of affordable(state)) {
    const cost = costOf(id, getLevel(state, id));
    const next = structuredClone(state) as SaveData;
    applyPurchase(next, id);
    const delta = incomePerSec(next, params) - baseInc;
    // Include a tiny cost-ratio tiebreaker so zero-delta upgrades still order by cheapness.
    const score = delta / Math.max(1, cost) + 1e-9 / cost;
    if (best == null || score > best.score) best = { id, score };
  }
  return best?.id ?? null;
};

function epsilonWrap(inner: Strategy, epsilon: number): Strategy {
  return (state, params, rng) => {
    const aff = affordable(state);
    if (aff.length === 0) return null;
    if (rng() < epsilon) return aff[Math.floor(rng() * aff.length)];
    return inner(state, params, rng);
  };
}

function strategyFor(name: StrategyName, epsilon: number): Strategy {
  switch (name) {
    case "greedy":
      return greedyCheapest;
    case "bang":
      return bangPerBuck;
    case "epsilon-greedy":
      return epsilonWrap(greedyCheapest, epsilon);
    case "epsilon-bang":
      return epsilonWrap(bangPerBuck, epsilon);
  }
}

// ---------- Simulation core ----------

interface Purchase {
  t: number;
  id: UpgradeId;
  cost: number;
  incAfter: number;
}

interface Checkpoint {
  t: number;
  coins: number;
  incPerSec: number;
  purchases: number;
}

interface RunResult {
  finalT: number;
  purchases: Purchase[];
  checkpoints: Checkpoint[];
  finalState: SaveData;
  stalled: boolean;
}

const CHECKPOINT_SECS = [60, 300, 900, 1800, 3600, 7200, 14400];

function freshState(startCoins: number): SaveData {
  const s = structuredClone(defaults);
  s.collisionCount = startCoins;
  return s;
}

function runSim(
  strategy: Strategy,
  params: IncomeParams,
  args: CliArgs,
  rng: () => number,
): RunResult {
  const state = freshState(args.startCoins);
  const maxSec = args.maxHours * 3600;
  const purchases: Purchase[] = [];
  const checkpoints: Checkpoint[] = [];
  let cpIdx = 0;
  let t = 0;
  let stalled = false;

  const snapshot = (): void => {
    while (cpIdx < CHECKPOINT_SECS.length && CHECKPOINT_SECS[cpIdx] <= t) {
      checkpoints.push({
        t: CHECKPOINT_SECS[cpIdx],
        coins: state.collisionCount,
        incPerSec: incomePerSec(state, params),
        purchases: purchases.length,
      });
      cpIdx++;
    }
  };

  while (t < maxSec) {
    // Apply all affordable purchases this tick (strategy decides order).
    let bought = true;
    while (bought) {
      bought = false;
      const pick = strategy(state, params, rng);
      if (pick == null) break;
      const cost = costOf(pick, getLevel(state, pick));
      state.collisionCount -= cost;
      applyPurchase(state, pick);
      purchases.push({ t, id: pick, cost, incAfter: incomePerSec(state, params) });
      bought = true;
    }

    const inc = incomePerSec(state, params);
    if (inc <= 0) {
      let minCost = Infinity;
      for (const id of ALL_UPGRADE_IDS) {
        const level = getLevel(state, id);
        if (isMaxed(id, level)) continue;
        const c = costOf(id, level);
        if (c < minCost) minCost = c;
      }
      if (!Number.isFinite(minCost)) {
        // Everything maxed.
        break;
      }
      stalled = true;
      break;
    }

    // Jump ahead to when we can afford the next cheapest non-maxed upgrade.
    let next = Infinity;
    for (const id of ALL_UPGRADE_IDS) {
      const level = getLevel(state, id);
      if (isMaxed(id, level)) continue;
      const c = costOf(id, level);
      if (c < next) next = c;
    }
    const deficit = next - state.collisionCount;
    const step = deficit > 0 ? Math.max(args.dt, deficit / inc) : args.dt;
    const used = Math.min(step, maxSec - t);
    state.collisionCount += inc * used;
    t += used;
    snapshot();
  }
  // Final snapshot at end time.
  while (cpIdx < CHECKPOINT_SECS.length && CHECKPOINT_SECS[cpIdx] <= t) {
    checkpoints.push({
      t: CHECKPOINT_SECS[cpIdx],
      coins: state.collisionCount,
      incPerSec: incomePerSec(state, params),
      purchases: purchases.length,
    });
    cpIdx++;
  }

  return { finalT: t, purchases, checkpoints, finalState: state, stalled };
}

// ---------- Output ----------

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtCoins(n: number): string {
  if (!Number.isFinite(n)) return "inf";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
}

function stateSummary(state: Readonly<SaveData>): string {
  const sb = state.specialBalls;
  return [
    `mb=${state.maxBalls}`,
    `res=${state.ballRestitution.toFixed(2)}`,
    `ad=${state.autoDropInterval}`,
    `bm=${state.bounceMultiplier.toFixed(2)}`,
    `crit=${state.criticalChance.toFixed(2)}`,
    `md=${state.multiDrop}`,
    `rows=${state.expandRows}`,
    `cols=${state.expandCols}`,
    `bump=${state.hasBumpers ? 1 : 0}`,
    `zig=${state.hasZigzag ? 1 : 0}`,
    `traits=${state.hasSpecialBalls ? 1 : 0}`,
    `[big=${sb.big} prem=${sb.premium} crit=${sb.critical} life=${sb.life} split=${sb.split}]`,
  ].join(" ");
}

function printSingleRun(result: RunResult, args: CliArgs): void {
  console.log(
    `# single-run: strategy=${args.strategy} eps=${args.epsilon} hits=${args.hits} manual=${args.manual}/s`,
  );
  console.log(`# time      | event                         | coins     | inc/s    | state`);
  for (const p of result.purchases) {
    const stateAt = "—"; // state is not preserved per-purchase; keep compact
    void stateAt;
    console.log(
      `${fmtTime(p.t).padEnd(10)} | buy ${p.id.padEnd(25)} | ${fmtCoins(p.incAfter >= 0 ? p.incAfter : 0).padEnd(9)} | ${p.incAfter.toFixed(2).padStart(8)} | (see final below)`,
    );
  }
  console.log(
    `# done: t=${fmtTime(result.finalT)} purchases=${result.purchases.length} stalled=${result.stalled}`,
  );
  console.log(`# final: ${stateSummary(result.finalState)}`);
}

function printAggregate(results: RunResult[], args: CliArgs): void {
  console.log(
    `# aggregate: strategy=${args.strategy} eps=${args.epsilon} runs=${args.runs} hits=${args.hits} manual=${args.manual}/s max=${args.maxHours}h`,
  );
  console.log(
    `# checkpoint | coins (p10/p50/p90)           | inc/s (p10/p50/p90)          | purchases (p10/p50/p90)`,
  );
  for (let i = 0; i < CHECKPOINT_SECS.length; i++) {
    const tSec = CHECKPOINT_SECS[i];
    if (tSec > args.maxHours * 3600) break;
    const coinsArr: number[] = [];
    const incArr: number[] = [];
    const purArr: number[] = [];
    for (const r of results) {
      const cp = r.checkpoints[i];
      if (cp != null) {
        coinsArr.push(cp.coins);
        incArr.push(cp.incPerSec);
        purArr.push(cp.purchases);
      }
    }
    coinsArr.sort((a, b) => a - b);
    incArr.sort((a, b) => a - b);
    purArr.sort((a, b) => a - b);
    if (coinsArr.length === 0) continue;
    const cPart = `${fmtCoins(quantile(coinsArr, 0.1))}/${fmtCoins(quantile(coinsArr, 0.5))}/${fmtCoins(quantile(coinsArr, 0.9))}`;
    const iPart = `${quantile(incArr, 0.1).toFixed(2)}/${quantile(incArr, 0.5).toFixed(2)}/${quantile(incArr, 0.9).toFixed(2)}`;
    const pPart = `${quantile(purArr, 0.1).toFixed(0)}/${quantile(purArr, 0.5).toFixed(0)}/${quantile(purArr, 0.9).toFixed(0)}`;
    console.log(
      `${fmtTime(tSec).padEnd(12)} | ${cPart.padEnd(29)} | ${iPart.padEnd(28)} | ${pPart}`,
    );
  }
  // Stall rate + final-median upgrade mix.
  const stalled = results.filter((r) => r.stalled).length;
  console.log(`# stalled: ${stalled}/${results.length}`);
  // Aggregate each upgrade's final level: median.
  console.log(`# median final levels:`);
  const medianLine: string[] = [];
  for (const id of ALL_UPGRADE_IDS) {
    const levels = results.map((r) => getLevel(r.finalState, id)).sort((a, b) => a - b);
    medianLine.push(`${id}=${quantile(levels, 0.5).toFixed(0)}`);
  }
  console.log(`  ${medianLine.join(" ")}`);
}

// ---------- Entry ----------

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const params: IncomeParams = {
    hitsPerBallLife: args.hits,
    manualDropsPerSec: args.manual,
    ballLifetimeSec: args.ballLifetime,
  };
  const strategy = strategyFor(args.strategy, args.epsilon);
  const results: RunResult[] = [];
  for (let k = 0; k < args.runs; k++) {
    const rng = makeRng(args.seed + k);
    results.push(runSim(strategy, params, args, rng));
  }
  if (args.runs === 1) {
    printSingleRun(results[0], args);
  } else {
    printAggregate(results, args);
  }
}

main();
