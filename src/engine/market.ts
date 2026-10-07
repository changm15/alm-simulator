/**
 * Return-sequence generation.
 *
 * This is where sequence-of-returns risk lives: we generate a full per-year,
 * per-asset-class return path up front, then the cash-flow loop consumes it.
 * Because contributions and withdrawals happen against that path, the ORDER of
 * returns matters — an early drawdown hits a portfolio that has fewer years
 * left to recover and (in the withdrawal phase) forces selling into weakness.
 *
 * Assumptions are nominal, annual, long-run. They are planning inputs, not
 * forecasts; edit CAPITAL_MARKET_ASSUMPTIONS to run your own.
 */

import { ASSET_CLASSES, AssetClass, Allocation, ScenarioConfig } from "./types";
import { cholesky, makeNormal, makeRng } from "./rng";

export interface AssetAssumption {
  /** Expected nominal arithmetic return, base market path. */
  mean: number;
  /** Annual standard deviation. */
  vol: number;
  /**
   * Sensitivity to a market shock. Equities take the full hit; Treasuries
   * typically rally on a flight to quality, so their beta is negative. This is
   * the mechanism that makes a Treasury sleeve actually insulating rather than
   * just lower-return.
   */
  shockBeta: number;
}

export const CAPITAL_MARKET_ASSUMPTIONS: Record<AssetClass, AssetAssumption> = {
  usEquity: { mean: 0.075, vol: 0.17, shockBeta: 1.0 },
  intlEquity: { mean: 0.07, vol: 0.19, shockBeta: 1.05 },
  usTreasuries: { mean: 0.035, vol: 0.06, shockBeta: -0.15 },
  corporateBonds: { mean: 0.045, vol: 0.08, shockBeta: 0.35 },
  cash: { mean: 0.025, vol: 0.01, shockBeta: 0.0 },
};

/** Drift adjustment (in return points) applied per market path. */
const PATH_DRIFT: Record<
  ScenarioConfig["marketPath"],
  Record<AssetClass, number>
> = {
  optimistic: {
    usEquity: 0.02,
    intlEquity: 0.02,
    usTreasuries: 0.005,
    corporateBonds: 0.0075,
    cash: 0.0025,
  },
  base: {
    usEquity: 0,
    intlEquity: 0,
    usTreasuries: 0,
    corporateBonds: 0,
    cash: 0,
  },
  pessimistic: {
    usEquity: -0.025,
    intlEquity: -0.025,
    usTreasuries: -0.005,
    corporateBonds: -0.01,
    cash: -0.005,
  },
};

/**
 * Correlation matrix, ordered as ASSET_CLASSES. Using correlated draws matters:
 * with independent draws the model would massively overstate the diversification
 * benefit of holding five sleeves, and the allocation sweep would be garbage.
 */
export const CORRELATION: number[][] = [
  //  US    INTL   UST    CORP   CASH
  [1.0, 0.85, -0.15, 0.3, 0.0],
  [0.85, 1.0, -0.1, 0.3, 0.0],
  [-0.15, -0.1, 1.0, 0.6, 0.2],
  [0.3, 0.3, 0.6, 1.0, 0.1],
  [0.0, 0.0, 0.2, 0.1, 1.0],
];

const CHOL = cholesky(CORRELATION);

export type ReturnPath = Record<AssetClass, number>[];

export interface MarketPathOptions {
  horizonYears: number;
  startYear: number;
  scenario: ScenarioConfig;
  /** Skip the volatility draw and use expected returns exactly. */
  deterministic?: boolean;
  /**
   * Deterministic runs only. Supplying the allocation corrects for volatility
   * drag, turning the "mean return every year" path into an approximate MEDIAN
   * path. Without it a deterministic run lands well above the Monte Carlo
   * median — compounding the arithmetic mean is not the typical outcome — which
   * makes a headline number that contradicts the distribution beside it.
   */
  medianAdjustAllocation?: Allocation;
  seed?: number;
}

/**
 * Portfolio variance from the allocation, the per-class vols, and the real
 * correlation matrix: wᵀΣw. Using the correlation matrix matters — summing
 * weighted variances would ignore diversification and overstate the drag.
 */
export function portfolioVariance(allocation: Allocation): number {
  let v = 0;
  ASSET_CLASSES.forEach((ci, i) => {
    ASSET_CLASSES.forEach((cj, j) => {
      v +=
        allocation[ci] *
        allocation[cj] *
        CAPITAL_MARKET_ASSUMPTIONS[ci].vol *
        CAPITAL_MARKET_ASSUMPTIONS[cj].vol *
        CORRELATION[i][j];
    });
  });
  return v;
}

/**
 * Generate a per-year map of asset-class returns for the whole horizon.
 */
export function generateReturnPath(opts: MarketPathOptions): ReturnPath {
  const {
    horizonYears,
    startYear,
    scenario,
    deterministic,
    medianAdjustAllocation,
    seed = 1,
  } = opts;
  const drift = PATH_DRIFT[scenario.marketPath];

  // Subtracting σ²/2 from every class shifts the BLENDED return by exactly
  // σ_p²/2, because the weights sum to 1 — so the drag lands on the portfolio,
  // not on each sleeve in isolation.
  const drag =
    deterministic && medianAdjustAllocation
      ? portfolioVariance(normalizeAllocation(medianAdjustAllocation)) / 2
      : 0;
  const normal = makeNormal(makeRng(seed));
  const path: ReturnPath = [];

  for (let y = 0; y < horizonYears; y++) {
    // Correlated standard normals via Cholesky.
    const z = ASSET_CLASSES.map(() => (deterministic ? 0 : normal()));
    const correlated = CHOL.map((row) =>
      row.reduce((acc, coef, k) => acc + coef * z[k], 0),
    );

    const year = {} as Record<AssetClass, number>;
    ASSET_CLASSES.forEach((cls, i) => {
      const a = CAPITAL_MARKET_ASSUMPTIONS[cls];
      year[cls] = a.mean + drift[cls] - drag + correlated[i] * a.vol;
    });

    // Shock injection: applied on top of the drawn return in the shock year.
    if (
      scenario.shockYear !== undefined &&
      scenario.shockMagnitudePct !== undefined &&
      startYear + y === scenario.shockYear
    ) {
      const shock = scenario.shockMagnitudePct / 100;
      ASSET_CLASSES.forEach((cls) => {
        year[cls] += shock * CAPITAL_MARKET_ASSUMPTIONS[cls].shockBeta;
      });
    }

    // A total loss in one year is not a thing for a diversified sleeve.
    ASSET_CLASSES.forEach((cls) => {
      year[cls] = Math.max(year[cls], -0.95);
    });

    path.push(year);
  }

  return path;
}

/** Weighted return across the allocation for a single year. */
export function blendedReturn(
  allocation: Allocation,
  yearReturns: Record<AssetClass, number>,
): number {
  return ASSET_CLASSES.reduce(
    (acc, cls) => acc + allocation[cls] * yearReturns[cls],
    0,
  );
}

/** Normalize an allocation so the weights sum to 1. Throws on all-zero. */
export function normalizeAllocation(allocation: Allocation): Allocation {
  const total = ASSET_CLASSES.reduce((a, c) => a + allocation[c], 0);
  if (total <= 0) throw new Error("Allocation weights must sum to > 0");
  const out = {} as Allocation;
  ASSET_CLASSES.forEach((c) => {
    out[c] = allocation[c] / total;
  });
  return out;
}
