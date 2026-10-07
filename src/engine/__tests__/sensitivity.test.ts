import { describe, expect, it } from "vitest";
import { reallocate, runAllocationSweep, compareSweeps } from "../sensitivity";
import { ASSET_CLASSES, SimulationConfig } from "../types";
import { baseConfig, retireeConfig, BALANCED } from "./fixtures";

const stochastic = (c: SimulationConfig): SimulationConfig => ({
  ...c,
  deterministic: false,
});

const stressScenario: SimulationConfig["scenario"] = {
  marketPath: "pessimistic",
  shockYear: 2031,
  shockMagnitudePct: -35,
  correlatedStressPreset: "recession_plus_layoff",
};

describe("allocation sweep", () => {
  it("reallocate keeps weights summing to 1 and scales the rest proportionally", () => {
    const out = reallocate(BALANCED, "usTreasuries", 0.5);
    const total = ASSET_CLASSES.reduce((a, c) => a + out[c], 0);

    expect(total).toBeCloseTo(1, 10);
    expect(out.usTreasuries).toBeCloseTo(0.5, 10);
    // Equity sleeves keep their relative sizes to each other.
    expect(out.usEquity / out.intlEquity).toBeCloseTo(
      BALANCED.usEquity / BALANCED.intlEquity,
      10,
    );
  });

  it("reports every percentile the UI can shade", () => {
    const sweep = runAllocationSweep(stochastic(baseConfig()), "base case", {
      pathsPerPoint: 120,
    });
    for (const p of sweep.points) {
      expect(p.p10Terminal).toBeLessThanOrEqual(p.p25Terminal);
      expect(p.p25Terminal).toBeLessThanOrEqual(p.medianTerminal);
      expect(p.medianTerminal).toBeLessThanOrEqual(p.p75Terminal);
      expect(p.p75Terminal).toBeLessThanOrEqual(p.p90Terminal);
    }
  });

  it("the trade-off is monotonic: more Treasuries narrows the spread and cuts drawdown", () => {
    const sweep = runAllocationSweep(
      stochastic(baseConfig()),
      "base case",
      { pathsPerPoint: 300 },
    );

    for (let i = 1; i < sweep.points.length; i++) {
      const prev = sweep.points[i - 1];
      const cur = sweep.points[i];
      expect(cur.spread).toBeLessThan(prev.spread);
      expect(cur.medianMaxDrawdownPct).toBeLessThan(prev.medianMaxDrawdownPct);
      // And the price of that insulation: the median outcome falls.
      expect(cur.medianTerminal).toBeLessThan(prev.medianTerminal);
      // Downside protection is real at the tail: the 10th percentile rises
      // monotonically. Note this does NOT extend inward — see the test below.
      expect(cur.p10Terminal).toBeGreaterThan(prev.p10Terminal * 0.98);
    }
  });

  it("the 25th percentile turns over, unlike the 10th", () => {
    // Worth pinning down, because it changes how the chart reads. The 10th
    // percentile keeps improving as Treasuries rise — that is tail insurance
    // doing its job. The 25th sits close enough to the median that the
    // median's downward drift overtakes the risk reduction partway through,
    // so an interquartile band narrows from BOTH sides rather than showing a
    // rising floor.
    const sweep = runAllocationSweep(stochastic(baseConfig()), "base case", {
      pathsPerPoint: 300,
    });
    const p25 = sweep.points.map((p) => p.p25Terminal);
    const peak = p25.indexOf(Math.max(...p25));

    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(p25.length - 1);
    expect(p25[p25.length - 1]).toBeLessThan(p25[peak]);
  });

  it("the value of the insulation is scenario-dependent", () => {
    const [base, stress] = compareSweeps(
      [
        { label: "base case", config: stochastic(baseConfig()) },
        {
          label: "recession + layoff in year 5",
          config: stochastic(baseConfig({ scenario: stressScenario })),
        },
      ],
      { pathsPerPoint: 300 },
    );

    const relMedianDrop = (s: typeof base) => {
      const first = s.points[0].medianTerminal;
      const last = s.points[s.points.length - 1].medianTerminal;
      return (first - last) / first;
    };
    const relDownsideGain = (s: typeof base) => {
      const first = s.points[0].p10Terminal;
      const last = s.points[s.points.length - 1].p10Terminal;
      return (last - first) / Math.max(first, 1);
    };

    // In the base case, Treasuries cost you real median upside.
    expect(relMedianDrop(base)).toBeGreaterThan(0.1);
    // In the stress case, they cost far less median — and buy far more
    // downside protection. That gap is the whole point of the feature.
    expect(relMedianDrop(stress)).toBeLessThan(relMedianDrop(base));
    expect(relDownsideGain(stress)).toBeGreaterThan(relDownsideGain(base));
  });

  it("holding Treasuries reduces shortfall probability under stress", () => {
    const sweep = runAllocationSweep(
      stochastic(
        retireeConfig({
          scenario: {
            marketPath: "pessimistic",
            shockYear: 2029,
            shockMagnitudePct: -35,
            correlatedStressPreset: "recession_plus_expense_shock",
          },
        }),
      ),
      "early exit into a recession",
      { pathsPerPoint: 300 },
    );

    const first = sweep.points[0];
    const last = sweep.points[sweep.points.length - 1];
    expect(first.shortfallProbability).toBeGreaterThan(0);
    expect(last.shortfallProbability).toBeLessThan(first.shortfallProbability);
  });
});
