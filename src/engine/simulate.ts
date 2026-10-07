/**
 * Monte Carlo wrapper around the single-path cash-flow engine.
 *
 * Every path reuses the same configs and differs only in the random seed, so
 * the spread you see is market-path uncertainty, not config noise.
 */

import { runPath } from "./cashflow";
import { percentile } from "./rng";
import { PathResult, SimulationConfig } from "./types";

export interface DistributionSummary {
  median: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  mean: number;
  min: number;
  max: number;
}

/** Percentile pair a chart shades. Presentation choice, not a model choice. */
export type BandKey = "p25_p50" | "p25_p75" | "p10_p90";

export const BAND_OPTIONS: {
  key: BandKey;
  label: string;
  lo: keyof DistributionSummary;
  hi: keyof DistributionSummary;
}[] = [
  { key: "p25_p75", label: "25th–75th", lo: "p25", hi: "p75" },
  { key: "p10_p90", label: "10th–90th", lo: "p10", hi: "p90" },
  { key: "p25_p50", label: "25th–50th", lo: "p25", hi: "median" },
];

/** Defaults to the interquartile range when handed an unknown key. */
export function bandFor(key: BandKey) {
  return BAND_OPTIONS.find((b) => b.key === key) ?? BAND_OPTIONS[0];
}

export interface MonteCarloResult {
  paths: PathResult[];
  terminalNetWorth: DistributionSummary;
  maxDrawdownPct: DistributionSummary;
  /** Time-weighted annualized portfolio return across the horizon. */
  annualizedReturnPct: DistributionSummary;
  /** Lifetime dollars contributed out of income. */
  totalContributions: DistributionSummary;
  /** Lifetime dollars of market gain. */
  totalInvestmentGain: DistributionSummary;
  /** Lifetime tax paid — income + payroll + capital gains. */
  totalTaxPaid: DistributionSummary;
  /** Lifetime realized capital gains, and the tax on them. */
  totalRealizedGains: DistributionSummary;
  totalCapitalGainsTax: DistributionSummary;
  /** Lifetime government benefit received, net of any clawback. */
  totalBenefitsReceived: DistributionSummary;
  /** Share of paths where spending could not be funded in some year. */
  shortfallProbability: number;
  /** Median year index of the first funding failure, across failing paths. */
  medianFirstShortfallYearIndex: number | null;
  /**
   * Per-year net worth percentiles for the fan chart. Every band the UI can
   * shade is computed here; which pair gets drawn is a display choice.
   */
  netWorthBands: {
    year: number;
    p10: number;
    p25: number;
    median: number;
    p75: number;
    p90: number;
  }[];
  /** The single path closest to the median terminal outcome — the ledger view. */
  representativePath: PathResult;
}

function summarize(values: number[]): DistributionSummary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: percentile(sorted, 0.5),
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    mean: values.reduce((a, b) => a + b, 0) / (values.length || 1),
    min: sorted[0] ?? NaN,
    max: sorted[sorted.length - 1] ?? NaN,
  };
}

export interface MonteCarloOptions {
  paths?: number;
  baseSeed?: number;
}

export function runMonteCarlo(
  config: SimulationConfig,
  opts: MonteCarloOptions = {},
): MonteCarloResult {
  const n = config.deterministic ? 1 : (opts.paths ?? 500);
  const baseSeed = opts.baseSeed ?? config.seed ?? 1;

  const paths: PathResult[] = [];
  for (let i = 0; i < n; i++) {
    // Spread seeds widely so consecutive runs are not near-duplicates.
    paths.push(runPath({ ...config, seed: baseSeed + i * 7919 }));
  }

  const terminals = paths.map((p) => p.terminalNetWorth);
  const drawdowns = paths.map((p) => p.maxDrawdownPct);
  const failing = paths.filter((p) => p.firstShortfallYearIndex !== null);

  const bands: MonteCarloResult["netWorthBands"] = [];
  for (let y = 0; y < config.horizonYears; y++) {
    const vals = paths.map((p) => p.years[y].netWorth).sort((a, b) => a - b);
    bands.push({
      year: config.income.startYear + y,
      p10: percentile(vals, 0.1),
      p25: percentile(vals, 0.25),
      median: percentile(vals, 0.5),
      p75: percentile(vals, 0.75),
      p90: percentile(vals, 0.9),
    });
  }

  const medianTerminal = percentile(
    [...terminals].sort((a, b) => a - b),
    0.5,
  );
  let representativePath = paths[0];
  let bestDelta = Infinity;
  for (const p of paths) {
    const d = Math.abs(p.terminalNetWorth - medianTerminal);
    if (d < bestDelta) {
      bestDelta = d;
      representativePath = p;
    }
  }

  const failIdx = failing
    .map((p) => p.firstShortfallYearIndex as number)
    .sort((a, b) => a - b);

  return {
    paths,
    terminalNetWorth: summarize(terminals),
    maxDrawdownPct: summarize(drawdowns),
    annualizedReturnPct: summarize(paths.map((p) => p.annualizedReturnPct)),
    totalContributions: summarize(paths.map((p) => p.totalContributions)),
    totalInvestmentGain: summarize(paths.map((p) => p.totalInvestmentGain)),
    totalTaxPaid: summarize(paths.map((p) => p.totalTaxPaid)),
    totalRealizedGains: summarize(paths.map((p) => p.totalRealizedGains)),
    totalCapitalGainsTax: summarize(paths.map((p) => p.totalCapitalGainsTax)),
    totalBenefitsReceived: summarize(paths.map((p) => p.totalBenefitsReceived)),
    shortfallProbability: paths.length ? failing.length / paths.length : 0,
    medianFirstShortfallYearIndex: failIdx.length
      ? percentile(failIdx, 0.5)
      : null,
    netWorthBands: bands,
    representativePath,
  };
}
