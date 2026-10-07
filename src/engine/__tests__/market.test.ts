import { describe, expect, it } from "vitest";
import { cholesky } from "../rng";
import { CORRELATION, generateReturnPath, portfolioVariance } from "../market";
import { runPath } from "../cashflow";
import { runMonteCarlo } from "../simulate";
import { BALANCED, baseConfig, retireeConfig } from "./fixtures";

describe("market model", () => {
  it("the correlation matrix is positive definite", () => {
    expect(() => cholesky(CORRELATION)).not.toThrow();
  });

  it("injects the shock only in the shock year, and Treasuries rally into it", () => {
    const path = generateReturnPath({
      horizonYears: 10,
      startYear: 2026,
      scenario: { marketPath: "base", shockYear: 2028, shockMagnitudePct: -30 },
      deterministic: true,
    });

    expect(path[2].usEquity).toBeLessThan(-0.2);
    // Flight to quality: a negative shock beta means Treasuries gain.
    expect(path[2].usTreasuries).toBeGreaterThan(path[1].usTreasuries);
    expect(path[3].usEquity).toBeGreaterThan(0);
  });

  it("sequence-of-returns risk: in decumulation an early shock is worse than a late one", () => {
    // Same shock magnitude, same average return over the horizon — only the
    // timing differs. Selling into an early drawdown permanently removes
    // shares that would otherwise have compounded.
    const early = runPath(
      retireeConfig({
        scenario: { marketPath: "base", shockYear: 2028, shockMagnitudePct: -35 },
      }),
    );
    const late = runPath(
      retireeConfig({
        scenario: { marketPath: "base", shockYear: 2044, shockMagnitudePct: -35 },
      }),
    );

    expect(early.terminalNetWorth).toBeLessThan(late.terminalNetWorth);
  });

  it("in pure accumulation the SAME shock is worse late, not early", () => {
    // Documenting this deliberately: sequence risk flips sign depending on
    // whether you are contributing or withdrawing. An early drawdown hits a
    // small balance and every later contribution buys in cheap; a late
    // drawdown hits the full accumulated balance with no time to recover.
    const early = runPath(
      baseConfig({
        scenario: { marketPath: "base", shockYear: 2028, shockMagnitudePct: -35 },
      }),
    );
    const late = runPath(
      baseConfig({
        scenario: { marketPath: "base", shockYear: 2050, shockMagnitudePct: -35 },
      }),
    );

    expect(late.terminalNetWorth).toBeLessThan(early.terminalNetWorth);
  });
});

describe("volatility drag", () => {
  it("a plain deterministic run lands ABOVE the Monte Carlo median", () => {
    // Not a bug — compounding the arithmetic mean every year is not the typical
    // outcome. The gap widens with the horizon: ~8% over this 30-year fixture,
    // roughly 50% over a 63-year plan. This pins it so the correction below has
    // something to correct.
    const plain = runPath({ ...baseConfig(), deterministic: true });
    const mc = runMonteCarlo({ ...baseConfig(), deterministic: false }, { paths: 400 });

    expect(plain.terminalNetWorth).toBeGreaterThan(mc.terminalNetWorth.median * 1.05);
  });

  it("the median-adjusted run tracks the Monte Carlo median closely", () => {
    const adjusted = runPath({
      ...baseConfig(),
      deterministic: true,
      medianAdjusted: true,
    });
    const mc = runMonteCarlo({ ...baseConfig(), deterministic: false }, { paths: 400 });
    const ratio = adjusted.terminalNetWorth / mc.terminalNetWorth.median;

    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  });

  it("the drag scales with portfolio risk: an all-cash mix barely moves", () => {
    const cash = {
      usEquity: 0, intlEquity: 0, usTreasuries: 0, corporateBonds: 0, cash: 1,
    };
    expect(portfolioVariance(cash)).toBeCloseTo(0.0001, 6);
    // A 60/40-ish mix carries real drag.
    expect(portfolioVariance(BALANCED)).toBeGreaterThan(0.008);
  });
});
