import { describe, expect, it } from "vitest";
import { buildRegimeTimeline } from "../relocation";
import { runPath } from "../cashflow";
import { baseConfig } from "./fixtures";

describe("relocation", () => {
  it("switches jurisdiction at the event year and compounds multipliers", () => {
    const timeline = buildRegimeTimeline("nyc", 2026, 10, [
      { year: 2030, toJurisdiction: "seattle", expenseLevelMultiplier: 0.8 },
      { year: 2034, toJurisdiction: "la", expenseLevelMultiplier: 1.1 },
    ]);

    expect(timeline[0].jurisdiction).toBe("nyc");
    expect(timeline[3].jurisdiction).toBe("nyc");
    expect(timeline[4].jurisdiction).toBe("seattle");
    expect(timeline[4].expenseMultiplier).toBeCloseTo(0.8, 6);
    expect(timeline[8].jurisdiction).toBe("la");
    expect(timeline[8].expenseMultiplier).toBeCloseTo(0.88, 6);
  });

  it("NYC -> Seattle drops ordinary income tax but capital gains tax does not silently go to zero", () => {
    const cfg = baseConfig();
    cfg.scenario = {
      marketPath: "base",
      relocationEvents: [
        { year: 2031, toJurisdiction: "seattle", expenseLevelMultiplier: 0.8 },
      ],
      // A very large outlay after the move, big enough to push realized gains
      // past the WA capital gains excise threshold.
      manualExpenseShock: { year: 2035, amount: 1_400_000 },
    };
    cfg.assets.costBasisFraction = 0.2;

    const result = runPath(cfg);
    const beforeMove = result.years.find((y) => y.year === 2030)!;
    const afterMove = result.years.find((y) => y.year === 2032)!;
    const saleYear = result.years.find((y) => y.year === 2035)!;

    // Ordinary income tax falls: NY + NYC state/local goes away.
    expect(beforeMove.jurisdiction).toBe("nyc");
    expect(afterMove.jurisdiction).toBe("seattle");
    expect(afterMove.incomeTax).toBeLessThan(beforeMove.incomeTax * 0.8);

    // But the WA excise tax fires once the realized gain clears the threshold.
    expect(saleYear.realizedGains).toBeGreaterThan(270_000);
    expect(saleYear.capitalGainsTax).toBeGreaterThan(0);

    // Specifically: strictly more than the federal-only bill would be.
    const federalOnlyUpperBound = saleYear.realizedGains * 0.238;
    expect(saleYear.capitalGainsTax).toBeGreaterThan(federalOnlyUpperBound);
  });
});
