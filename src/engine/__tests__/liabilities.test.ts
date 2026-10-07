import { describe, expect, it } from "vitest";
import { DEFAULT_EXPENSE_CATEGORIES, expensesForYear } from "../liabilities";
import { runPath } from "../cashflow";
import { LiabilityConfig } from "../types";
import { baseConfig } from "./fixtures";

const cfg: LiabilityConfig = {
  baseAnnualExpenses: 0,
  inflationAssumptionPct: 2.5,
  expenseCategories: [
    { label: "Housing", annualAmount: 40_000, colSensitivity: 1, essential: true },
    {
      label: "Healthcare",
      annualAmount: 6_000,
      inflationPct: 5,
      colSensitivity: 0,
      essential: true,
    },
    {
      label: "Travel",
      annualAmount: 10_000,
      colSensitivity: 0.3,
      essential: false,
    },
  ],
  postExitDiscretionaryCutPct: 40,
};

const plain = {
  expenseMultiplier: 1,
  wageIncomeEnded: false,
};

describe("expense categories", () => {
  it("sums the categories and itemizes them", () => {
    const e = expensesForYear(cfg, 0, 2026, plain);
    expect(e.total).toBeCloseTo(56_000, 2);
    expect(e.items.map((i) => i.label)).toEqual([
      "Housing",
      "Healthcare",
      "Travel",
    ]);
  });

  it("inflates each category at its own rate", () => {
    const e = expensesForYear(cfg, 10, 2026, plain);
    const housing = e.items.find((i) => i.label === "Housing")!.amount;
    const health = e.items.find((i) => i.label === "Healthcare")!.amount;

    expect(housing).toBeCloseTo(40_000 * Math.pow(1.025, 10), 0);
    // Healthcare compounds at 5%, so it grows faster than headline inflation.
    expect(health).toBeCloseTo(6_000 * Math.pow(1.05, 10), 0);
    expect(health / 6_000).toBeGreaterThan(housing / 40_000);
  });

  it("applies a relocation only to the cost-of-living-sensitive share", () => {
    const e = expensesForYear(cfg, 0, 2026, {
      ...plain,
      expenseMultiplier: 0.8,
    });
    const housing = e.items.find((i) => i.label === "Housing")!.amount;
    const health = e.items.find((i) => i.label === "Healthcare")!.amount;
    const travel = e.items.find((i) => i.label === "Travel")!.amount;

    // Housing fully tracks the move; healthcare not at all; travel 30%.
    expect(housing).toBeCloseTo(40_000 * 0.8, 2);
    expect(health).toBeCloseTo(6_000, 2);
    expect(travel).toBeCloseTo(10_000 * (1 - 0.2 * 0.3), 2);
  });

  it("cuts only non-essential categories once wage income stops", () => {
    const e = expensesForYear(cfg, 0, 2026, {
      ...plain,
      wageIncomeEnded: true,
    });
    expect(e.items.find((i) => i.label === "Housing")!.amount).toBeCloseTo(
      40_000,
      2,
    );
    expect(e.items.find((i) => i.label === "Travel")!.amount).toBeCloseTo(
      6_000,
      2,
    );
  });

  it("the default plan is internally consistent and flows into the engine", () => {
    const total = DEFAULT_EXPENSE_CATEGORIES.reduce(
      (a, c) => a + c.annualAmount,
      0,
    );
    const sim = baseConfig();
    sim.liabilities = {
      baseAnnualExpenses: 0,
      inflationAssumptionPct: 2.5,
      expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
    };
    const y0 = runPath(sim).years[0];

    expect(y0.expenses).toBeCloseTo(total, 0);
    expect(y0.expenseBreakdown.reduce((a, i) => a + i.amount, 0)).toBeCloseTo(
      y0.expenses,
      2,
    );
  });
});
