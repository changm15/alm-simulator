import { describe, expect, it } from "vitest";
import { runPath } from "../cashflow";
import { BAND_OPTIONS, bandFor, runMonteCarlo } from "../simulate";
import { baseConfig } from "./fixtures";

describe("core cash-flow loop", () => {
  it("flat income, base market, no events produces smooth monotonic growth", () => {
    const result = runPath(baseConfig());

    expect(result.years).toHaveLength(30);
    for (let i = 1; i < result.years.length; i++) {
      expect(result.years[i].netWorth).toBeGreaterThan(
        result.years[i - 1].netWorth,
      );
    }
    // Deterministic base path: no volatility, so no drawdown at all.
    expect(result.maxDrawdownPct).toBeCloseTo(0, 6);
    expect(result.firstShortfallYearIndex).toBeNull();
    // Every year should be a contribution year, never a forced sale.
    expect(result.years.every((y) => y.withdrawal === 0)).toBe(true);
  });

  it("balances reconcile: opening * (1+r) + contribution - withdrawal", () => {
    const result = runPath(baseConfig());
    let prior =
      baseConfig().assets.currentBalance +
      (baseConfig().assets.startingCashBuffer ?? 0);

    for (const y of result.years) {
      const r = y.blendedReturnPct / 100;
      const expected = prior * (1 + r) + y.freeCashFlow;
      // freeCashFlow is split between the portfolio and the cash buffer, and
      // the buffer earns the cash return rather than the blended return, so
      // allow a small tolerance rather than an exact identity.
      expect(y.netWorth).toBeGreaterThan(expected * 0.98);
      expect(y.netWorth).toBeLessThan(expected * 1.02);
      prior = y.netWorth;
    }
  });

  it("does not let taxes exceed income in a normal earning year", () => {
    const result = runPath(baseConfig());
    for (const y of result.years) {
      expect(y.totalTax).toBeLessThan(y.totalIncome * 0.6);
      expect(y.totalTax).toBeGreaterThan(0);
    }
  });

  it("contributionRatePct below 100 routes the remainder to the cash buffer", () => {
    const cfg = baseConfig();
    cfg.assets.contributionRatePct = 5;
    const result = runPath(cfg);
    const y0 = result.years[0];

    expect(y0.contribution).toBeCloseTo(y0.totalIncome * 0.05, 2);
    expect(y0.cashBuffer).toBeGreaterThan(0);
  });
});

describe("percentile bands", () => {
  it("net worth bands are ordered p10 <= p25 <= median <= p75 <= p90", () => {
    const mc = runMonteCarlo(
      { ...baseConfig(), deterministic: false },
      { paths: 200 },
    );
    for (const b of mc.netWorthBands) {
      expect(b.p10).toBeLessThanOrEqual(b.p25);
      expect(b.p25).toBeLessThanOrEqual(b.median);
      expect(b.median).toBeLessThanOrEqual(b.p75);
      expect(b.p75).toBeLessThanOrEqual(b.p90);
    }
  });

  it("bandFor resolves each option to a low/high pair on the summary", () => {
    const mc = runMonteCarlo(
      { ...baseConfig(), deterministic: false },
      { paths: 120 },
    );
    for (const opt of BAND_OPTIONS) {
      const spec = bandFor(opt.key);
      const lo = mc.terminalNetWorth[spec.lo] as number;
      const hi = mc.terminalNetWorth[spec.hi] as number;
      expect(lo).toBeLessThanOrEqual(hi);
    }
    // The default band tops out at the median, by design.
    expect(bandFor("p25_p50").hi).toBe("median");
  });
});
