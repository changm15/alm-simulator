import { describe, expect, it } from "vitest";
import { resolveScenario, scenarioWarnings } from "../scenario";
import { runPath } from "../cashflow";
import { baseConfig } from "./fixtures";

describe("scenario resolution", () => {
  it("a correlated preset ties the market leg and the personal leg to one year", () => {
    const resolved = resolveScenario(
      {
        marketPath: "pessimistic",
        shockYear: 2031,
        correlatedStressPreset: "recession_plus_layoff",
      },
      2026,
      20,
      90_000,
    );

    // The preset supplies its own market magnitude — the user cannot have the
    // layoff without the drawdown.
    expect(resolved.shockMagnitudePct).toBeLessThan(0);
    expect(resolved.incomeMultiplierByYearIndex[5]).toBeLessThan(0.2);
    expect(resolved.incomeMultiplierByYearIndex[6]).toBeLessThan(1);
    expect(resolved.incomeMultiplierByYearIndex[10]).toBeCloseTo(0.9, 6);
  });

  it("refuses a preset without a shock year rather than silently decoupling", () => {
    expect(() =>
      resolveScenario(
        { marketPath: "base", correlatedStressPreset: "recession_plus_layoff" },
        2026,
        20,
        90_000,
      ),
    ).toThrow(/shockYear/);
  });

  it("flags an uncorrelated hand-built stress as understating risk", () => {
    const warnings = scenarioWarnings({
      marketPath: "pessimistic",
      shockYear: 2031,
      manualIncomeShock: { year: 2040, incomeMultiplier: 0, years: 1 },
    });
    expect(warnings.join(" ")).toMatch(/understates joint risk/);
  });

  it("does not flag a correctly correlated setup", () => {
    expect(
      scenarioWarnings({
        marketPath: "pessimistic",
        shockYear: 2031,
        correlatedStressPreset: "recession_plus_layoff",
      }),
    ).toHaveLength(0);
  });

  it("a layoff forces a withdrawal instead of a contribution", () => {
    const cfg = baseConfig({
      scenario: {
        marketPath: "pessimistic",
        shockYear: 2031,
        shockMagnitudePct: -35,
        correlatedStressPreset: "recession_plus_layoff",
      },
    });
    const result = runPath(cfg);
    const layoffYear = result.years.find((y) => y.year === 2031)!;

    expect(layoffYear.freeCashFlow).toBeLessThan(0);
    expect(layoffYear.withdrawal).toBeGreaterThan(0);
    expect(layoffYear.contribution).toBe(0);
    // The forced sale in a down year realizes gains and triggers tax.
    expect(layoffYear.realizedGains).toBeGreaterThan(0);
  });
});
