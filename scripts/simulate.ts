// Economy tuning simulator.
//
// Greedy-buys the cheapest affordable non-maxed upgrade each tick and logs the
// timeline. Use it to spot progression stalls, bought-in-seconds milestones,
// and the shape of the income curve before tuning costGrowth in economy.ts.
//
// Usage:
//   vp dlx tsx scripts/simulate.ts
//   vp dlx tsx scripts/simulate.ts --hits 18 --manual 0.3 --max-hours 4
//
// Assumptions (tweak via CLI flags):
//   --hits N           Average wall/obstacle hits per ball life. Default: 15.
//   --manual R         Manual click drops/sec (0 = fully AFK). Default: 0.
//   --max-hours H      Stop after H hours of sim time. Default: 2.
//   --dt S             Simulation tick length in seconds. Default: 1.
//   --start-coins N    Starting collisionCount. Default: 0.

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

interface CliArgs {
  hits: number;
  manual: number;
  maxHours: number;
  dt: number;
  startCoins: number;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    hits: 15,
    manual: 0,
    maxHours: 2,
    dt: 1,
    startCoins: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--hits":
        out.hits = Number(next);
        i++;
        break;
      case "--manual":
        out.manual = Number(next);
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

function freshState(startCoins: number): SaveData {
  const s = structuredClone(defaults);
  s.collisionCount = startCoins;
  return s;
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatCoins(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}

function cheapestAffordable(state: Readonly<SaveData>): { id: UpgradeId; cost: number } | null {
  let best: { id: UpgradeId; cost: number } | null = null;
  for (const id of ALL_UPGRADE_IDS) {
    const level = getLevel(state, id);
    if (isMaxed(id, level)) continue;
    const cost = costOf(id, level);
    if (cost > state.collisionCount) continue;
    if (best == null || cost < best.cost) {
      best = { id, cost };
    }
  }
  return best;
}

function nextCheapestCost(state: Readonly<SaveData>): number {
  let min = Infinity;
  for (const id of ALL_UPGRADE_IDS) {
    const level = getLevel(state, id);
    if (isMaxed(id, level)) continue;
    const cost = costOf(id, level);
    if (cost < min) min = cost;
  }
  return min;
}

function simulate(args: CliArgs): void {
  const params: IncomeParams = {
    hitsPerBallLife: args.hits,
    manualDropsPerSec: args.manual,
  };
  const state = freshState(args.startCoins);
  const maxSec = args.maxHours * 3600;
  let t = 0;
  let purchases = 0;

  console.log(
    `# simulator: hits=${args.hits} manual=${args.manual}/s dt=${args.dt}s max=${args.maxHours}h`,
  );
  console.log(`# time      | event                         | coins     | inc/s    | state`);

  while (t < maxSec) {
    // Buy greedily until nothing is affordable.
    let bought = true;
    while (bought) {
      bought = false;
      const pick = cheapestAffordable(state);
      if (pick == null) break;
      state.collisionCount -= pick.cost;
      applyPurchase(state, pick.id);
      purchases++;
      const inc = incomePerSec(state, params);
      console.log(
        `${formatTime(t).padEnd(10)} | buy ${pick.id.padEnd(25)} | ${formatCoins(state.collisionCount).padEnd(9)} | ${inc.toFixed(2).padStart(8)} | ${stateSummary(state)}`,
      );
      bought = true;
    }

    const inc = incomePerSec(state, params);
    if (inc <= 0) {
      const next = nextCheapestCost(state);
      if (!Number.isFinite(next)) {
        console.log(`# all upgrades maxed at ${formatTime(t)}`);
        break;
      }
      console.log(
        `# stalled at ${formatTime(t)} — income 0 and next cheapest=${formatCoins(next)} (need a manual click or auto-drop unlock)`,
      );
      break;
    }

    // Advance time: if income covers next purchase quickly, jump; otherwise dt.
    const next = nextCheapestCost(state);
    const deficit = next - state.collisionCount;
    const step = deficit > 0 ? Math.max(args.dt, deficit / inc) : args.dt;
    const used = Math.min(step, maxSec - t);
    state.collisionCount += inc * used;
    t += used;
  }

  console.log(
    `# done: t=${formatTime(t)} purchases=${purchases} coins=${formatCoins(state.collisionCount)}`,
  );
  console.log(`# final state:`);
  console.log(stateSummary(state, true));
}

function stateSummary(state: Readonly<SaveData>, verbose = false): string {
  const parts: string[] = [];
  parts.push(`mb=${state.maxBalls}`);
  parts.push(`res=${state.ballRestitution.toFixed(2)}`);
  parts.push(`ad=${state.autoDropInterval}`);
  parts.push(`bm=${state.bounceMultiplier.toFixed(2)}`);
  parts.push(`crit=${state.criticalChance.toFixed(2)}`);
  parts.push(`md=${state.multiDrop}`);
  if (verbose) {
    parts.push(`rows=${state.expandRows}`);
    parts.push(`cols=${state.expandCols}`);
    parts.push(`bump=${state.hasBumpers ? 1 : 0}`);
    parts.push(`zig=${state.hasZigzag ? 1 : 0}`);
    parts.push(`traits=${state.hasSpecialBalls ? 1 : 0}`);
    const sb = state.specialBalls;
    parts.push(
      `[big=${sb.big} prem=${sb.premium} crit=${sb.critical} life=${sb.life} split=${sb.split}]`,
    );
  }
  return parts.join(" ");
}

simulate(parseArgs(process.argv.slice(2)));
