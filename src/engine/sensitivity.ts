/**
 * Allocation sensitivity sweep — the actual product.
 *
 * Hold everything else fixed, sweep one sleeve (Treasuries by default) across a
 * range, and re-run the full Monte Carlo at each point. The remaining sleeves
 * keep their relative proportions, so raising Treasuries from 10% to 40% pulls
 * proportionally from every other holding rather than from equities alone.
 *
 * The output is deliberately a table of outcomes, not a recommendation. The
 * shape of the trade-off — spread narrows, drawdown falls, median falls — is
 * the thing worth looking at, and how much the insulation is worth depends
 * entirely on which scenario you are looking at.
 */

import { runMonteCarlo } from "./simulate";
import { normalizeAllocation } from "./market";
import {
  ASSET_CLASSES,
  Allocation,
  AssetClass,
  SimulationConfig,
} from "./types";

export interface AllocationPoint {
  /** Weight of the swept sleeve at this point, as a percentage. */
  sweptWeightPct: number;
  allocation: Allocation;
  medianTerminal: number;
  p10Terminal: number;
  p25Terminal: number;
  p75Terminal: number;
  p90Terminal: number;
  /** p90 - p10: the full width of the outcome range. */
  spread: number;
  medianMaxDrawdownPct: number;
  p90MaxDrawdownPct: number;
  shortfallProbability: number;
}

export interface SweepResult {
  sweptClass: AssetClass;
  scenarioLabel: string;
  points: AllocationPoint[];
}

export interface SweepOptions {
  sweptClass?: AssetClass;
  /** Sweep values as percentages, e.g. [0, 10, 20, 30, 40, 50, 60]. */
  weightsPct?: number[];
  pathsPerPoint?: number;
  baseSeed?: number;
}

/**
 * Rebuild an allocation with `sweptClass` set to `weight`, scaling every other
 * sleeve proportionally into the remaining 1 - weight.
 */
export function reallocate(
  base: Allocation,
  sweptClass: AssetClass,
  weight: number,
): Allocation {
  const others = ASSET_CLASSES.filter((c) => c !== sweptClass);
  const otherTotal = others.reduce((a, c) => a + base[c], 0);
  const out = {} as Allocation;
  out[sweptClass] = weight;
  const remaining = 1 - weight;
  if (otherTotal <= 0) {
    // Degenerate base (everything already in the swept sleeve): spread evenly.
    others.forEach((c) => {
      out[c] = remaining / others.length;
    });
  } else {
    others.forEach((c) => {
      out[c] = (base[c] / otherTotal) * remaining;
    });
  }
  return out;
}

export function runAllocationSweep(
  config: SimulationConfig,
  scenarioLabel: string,
  opts: SweepOptions = {},
): SweepResult {
  const sweptClass = opts.sweptClass ?? "usTreasuries";
  const weightsPct = opts.weightsPct ?? [0, 10, 20, 30, 40, 50, 60];
  const pathsPerPoint = opts.pathsPerPoint ?? 400;
  const baseSeed = opts.baseSeed ?? config.seed ?? 1;
  const base = normalizeAllocation(config.assets.allocation);

  const points: AllocationPoint[] = weightsPct.map((pct) => {
    const allocation = reallocate(base, sweptClass, pct / 100);
    // Same baseSeed at every point: each allocation faces the SAME set of
    // market draws, so differences come from the allocation, not from noise.
    const mc = runMonteCarlo(
      { ...config, assets: { ...config.assets, allocation } },
      { paths: pathsPerPoint, baseSeed },
    );

    return {
      sweptWeightPct: pct,
      allocation,
      medianTerminal: mc.terminalNetWorth.median,
      p10Terminal: mc.terminalNetWorth.p10,
      p25Terminal: mc.terminalNetWorth.p25,
      p75Terminal: mc.terminalNetWorth.p75,
      p90Terminal: mc.terminalNetWorth.p90,
      spread: mc.terminalNetWorth.p90 - mc.terminalNetWorth.p10,
      medianMaxDrawdownPct: mc.maxDrawdownPct.median,
      p90MaxDrawdownPct: mc.maxDrawdownPct.p90,
      shortfallProbability: mc.shortfallProbability,
    };
  });

  return { sweptClass, scenarioLabel, points };
}

/**
 * Run the same sweep under two or more scenarios so the scenario-dependence of
 * the insulation is visible side by side.
 */
export function compareSweeps(
  variants: { label: string; config: SimulationConfig }[],
  opts: SweepOptions = {},
): SweepResult[] {
  return variants.map((v) => runAllocationSweep(v.config, v.label, opts));
}

/**
 * Descriptive summary of a sweep. Deliberately states what the numbers did
 * under the stated assumptions and stops there — no allocation recommendation.
 */
export function describeSweep(sweep: SweepResult): string {
  const first = sweep.points[0];
  const last = sweep.points[sweep.points.length - 1];
  if (!first || !last) return "No sweep points.";

  const pct = (a: number, b: number) =>
    a === 0 ? "n/a" : `${(((b - a) / Math.abs(a)) * 100).toFixed(0)}%`;

  return [
    `Under these assumptions, moving ${sweep.sweptClass} from ${first.sweptWeightPct}% to ${last.sweptWeightPct}% (${sweep.scenarioLabel}):`,
    `  median terminal net worth ${pct(first.medianTerminal, last.medianTerminal)} (${fmt(first.medianTerminal)} -> ${fmt(last.medianTerminal)})`,
    `  10th-90th percentile spread ${pct(first.spread, last.spread)} (${fmt(first.spread)} -> ${fmt(last.spread)})`,
    `  median max drawdown ${first.medianMaxDrawdownPct.toFixed(1)}% -> ${last.medianMaxDrawdownPct.toFixed(1)}%`,
    `  shortfall probability ${(first.shortfallProbability * 100).toFixed(1)}% -> ${(last.shortfallProbability * 100).toFixed(1)}%`,
  ].join("\n");
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}
