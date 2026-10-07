import { describe, expect, it } from "vitest";
import { incomeForYear, resolveExitYear, scheduledSalary } from "../income";
import { runPath } from "../cashflow";
import { IncomeConfig } from "../types";
import { baseConfig } from "./fixtures";

const scheduled: IncomeConfig = {
  baseSalary: 200_000,
  startYear: 2026,
  currentAge: 32,
  trajectory: "schedule",
  filingStatus: "single",
  salarySchedule: [
    { year: 2026, salary: 200_000 },
    { year: 2027, salary: 225_000 },
    { year: 2030, salary: 310_000 },
  ],
  postScheduleGrowthPct: 4,
};

describe("salary schedule", () => {
  it("uses the stated figure in a stated year", () => {
    expect(scheduledSalary(scheduled, 2026)).toBe(200_000);
    expect(scheduledSalary(scheduled, 2027)).toBe(225_000);
    expect(scheduledSalary(scheduled, 2030)).toBe(310_000);
  });

  it("holds the last stated figure across gaps rather than interpolating", () => {
    // 2028 and 2029 were never stated, so they hold 2027's number. Inventing
    // an interpolated value would be the model making up an input.
    expect(scheduledSalary(scheduled, 2028)).toBe(225_000);
    expect(scheduledSalary(scheduled, 2029)).toBe(225_000);
  });

  it("grows at the stated rate after the last entry", () => {
    expect(scheduledSalary(scheduled, 2031)).toBeCloseTo(310_000 * 1.04, 2);
    expect(scheduledSalary(scheduled, 2035)).toBeCloseTo(
      310_000 * Math.pow(1.04, 5),
      2,
    );
  });

  it("uses the first entry for years before the schedule starts", () => {
    expect(scheduledSalary({ ...scheduled, startYear: 2020 }, 2022)).toBe(
      200_000,
    );
  });

  it("returns null with no schedule, so other trajectories are untouched", () => {
    expect(scheduledSalary({ ...scheduled, salarySchedule: [] }, 2030)).toBeNull();
  });

  it("scheduled figures are NOMINAL — inflation is not layered on top", () => {
    // Year index 4 with a 30% cumulative inflation factor: the 2030 figure must
    // still come out as the $310,000 that was typed in.
    const y = incomeForYear(scheduled, 4, 1.3);
    expect(y.wage).toBeCloseTo(310_000, 2);
  });

  it("retirement age still cuts off a schedule", () => {
    const cfg: IncomeConfig = { ...scheduled, retirementAge: 60 };
    expect(resolveExitYear(cfg)).toBe(2054);

    const working = incomeForYear(cfg, 20, 1.5); // 2046, age 52
    const retired = incomeForYear(cfg, 30, 1.8); // 2056, age 62
    expect(working.wage).toBeGreaterThan(0);
    expect(retired.wage).toBe(0);
    expect(retired.wageIncomeEnded).toBe(true);
  });

  it("drives the full engine, and pay multipliers still apply on top", () => {
    const cfg = baseConfig({
      income: { ...scheduled, retirementAge: 70 },
      scenario: {
        marketPath: "base",
        relocationEvents: [
          { year: 2031, toJurisdiction: "seattle", incomeMultiplier: 0.9 },
        ],
      },
    });
    const result = runPath(cfg);

    expect(result.years.find((y) => y.year === 2027)!.grossWageIncome).toBeCloseTo(
      225_000,
      2,
    );
    // 2031: one year past the last entry, grown 4%, then cut 10% by the move.
    expect(result.years.find((y) => y.year === 2031)!.grossWageIncome).toBeCloseTo(
      310_000 * 1.04 * 0.9,
      2,
    );
  });
});
