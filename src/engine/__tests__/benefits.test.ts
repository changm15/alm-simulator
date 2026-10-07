import { describe, expect, it } from "vitest";
import {
  cppFactor,
  oasClawback,
  oasFactor,
  socialSecurityFactor,
  socialSecurityTaxablePortion,
} from "../benefits";
import { runPath } from "../cashflow";
import { computeTax } from "../tax";
import { baseConfig } from "./fixtures";

describe("claiming adjustments", () => {
  it("Social Security: 30% cut at 62, 24% credit at 70, against a 67 FRA", () => {
    // 36 months at 5/9 of 1% then 24 more at 5/12 of 1% = 20% + 10%.
    expect(socialSecurityFactor(62, 67)).toBeCloseTo(0.7, 6);
    expect(socialSecurityFactor(67, 67)).toBeCloseTo(1, 6);
    expect(socialSecurityFactor(70, 67)).toBeCloseTo(1.24, 6);
  });

  it("Social Security: credits stop accruing at 70", () => {
    expect(socialSecurityFactor(72, 67)).toBeCloseTo(
      socialSecurityFactor(70, 67),
      6,
    );
  });

  it("CPP: −0.6%/month before 65, +0.7%/month after", () => {
    expect(cppFactor(60)).toBeCloseTo(0.64, 6);
    expect(cppFactor(65)).toBeCloseTo(1, 6);
    expect(cppFactor(70)).toBeCloseTo(1.42, 6);
  });

  it("OAS cannot be claimed early and maxes at +36%", () => {
    expect(oasFactor(60)).toBeCloseTo(1, 6);
    expect(oasFactor(65)).toBeCloseTo(1, 6);
    expect(oasFactor(70)).toBeCloseTo(1.36, 6);
  });
});

describe("Social Security taxable portion", () => {
  const ss = socialSecurityTaxablePortion;

  it("is zero for a retiree with little other income", () => {
    expect(ss(24_000, 0, "single")).toBe(0);
  });

  it("phases in at 50%, then 85%, and never exceeds 85%", () => {
    // Provisional = 20,000 + 15,000 = 35,000, just past the 34,000 threshold.
    const mid = ss(30_000, 20_000, "single");
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(30_000 * 0.85);

    // A large other income pins it at the 85% cap.
    expect(ss(30_000, 200_000, "single")).toBeCloseTo(30_000 * 0.85, 6);
  });

  it("married thresholds are higher, so the same income is taxed less", () => {
    expect(ss(30_000, 30_000, "married")).toBeLessThan(
      ss(30_000, 30_000, "single"),
    );
  });

  it("thresholds are NOT indexed, so inflation drags more of the benefit in", () => {
    // Same situation in real terms, 25 years apart at 2.5% inflation: every
    // nominal figure roughly doubles, but the 25k/34k tests are fixed in
    // statute. This is a real effect, not a modelling slip.
    const infl = Math.pow(1.025, 25);
    const todayFraction = ss(30_000, 20_000, "single") / 30_000;
    const laterFraction =
      ss(30_000 * infl, 20_000 * infl, "single") / (30_000 * infl);

    // 18% of the benefit taxable today, 55% in 25 years, for an unchanged
    // standard of living. It keeps climbing toward the 85% ceiling from there.
    expect(todayFraction).toBeLessThan(0.2);
    expect(laterFraction).toBeGreaterThan(0.5);
    expect(laterFraction).toBeGreaterThan(todayFraction * 2.5);
    expect(laterFraction).toBeLessThan(0.85);
  });
});

describe("OAS recovery tax", () => {
  it("is nil below the threshold and claws back 15% above it", () => {
    expect(oasClawback(9_000, 50_000, 1)).toBe(0);
    // 20,000 over the 93,454 threshold at 15% = 3,000.
    expect(oasClawback(9_000, 113_454, 1)).toBeCloseTo(3_000, 2);
  });

  it("never takes more than the benefit itself", () => {
    expect(oasClawback(9_000, 500_000, 1)).toBeCloseTo(9_000, 6);
  });

  it("the threshold is indexed, unlike the US one", () => {
    expect(oasClawback(9_000, 113_454, 1.5)).toBeLessThan(
      oasClawback(9_000, 113_454, 1),
    );
  });
});

describe("benefits in the engine", () => {
  // A solvent retiree: the portfolio has to survive the whole horizon in BOTH
  // arms, otherwise "sells less" compares two zeros.
  const retiree = (patch = {}) =>
    baseConfig({
      income: {
        ...baseConfig().income,
        currentAge: 60,
        retirementAge: 62,
        ...patch,
      },
      assets: {
        ...baseConfig().assets,
        currentBalance: 2_500_000,
        startingCashBuffer: 0,
      },
      liabilities: {
        ...baseConfig().liabilities,
        baseAnnualExpenses: 85_000,
        retirementIncomeTargetAnnual: 85_000,
      },
      horizonYears: 35,
    });

  it("a benefit funds part of the liability, so the portfolio sells less", () => {
    const without = runPath(retiree());
    const withSS = runPath(
      retiree({
        retirementBenefit: {
          system: "us_social_security",
          claimAge: 67,
          monthlyAtFullRetirementAge: 3_000,
          fullRetirementAge: 67,
        },
      }),
    );

    const drawYear = 2040;
    const a = without.years.find((y) => y.year === drawYear)!;
    const b = withSS.years.find((y) => y.year === drawYear)!;

    expect(b.benefitNet).toBeGreaterThan(0);
    expect(b.withdrawal).toBeLessThan(a.withdrawal);
    expect(withSS.terminalNetWorth).toBeGreaterThan(without.terminalNetWorth);
    expect(withSS.totalBenefitsReceived).toBeGreaterThan(0);
  });

  it("pays nothing before the claim age, then starts", () => {
    const r = runPath(
      retiree({
        retirementBenefit: {
          system: "us_social_security",
          claimAge: 70,
          monthlyAtFullRetirementAge: 3_000,
        },
      }),
    );
    const before = r.years.find((y) => y.age === 69)!;
    const after = r.years.find((y) => y.age === 70)!;

    expect(before.benefitNet).toBe(0);
    expect(after.benefitNet).toBeGreaterThan(0);
  });

  it("claiming later pays more per year but starts later", () => {
    const early = runPath(
      retiree({
        retirementBenefit: {
          system: "us_social_security",
          claimAge: 62,
          monthlyAtFullRetirementAge: 3_000,
          fullRetirementAge: 67,
        },
      }),
    );
    const late = runPath(
      retiree({
        retirementBenefit: {
          system: "us_social_security",
          claimAge: 70,
          monthlyAtFullRetirementAge: 3_000,
          fullRetirementAge: 67,
        },
      }),
    );

    const atEighty = (p: typeof early) => p.years.find((y) => y.age === 80)!;
    expect(atEighty(late).benefitGross).toBeGreaterThan(
      atEighty(early).benefitGross * 1.7,
    );
    expect(early.years.find((y) => y.age === 65)!.benefitNet).toBeGreaterThan(0);
    expect(late.years.find((y) => y.age === 65)!.benefitNet).toBe(0);
  });

  it("Canadian OAS survives intact when retirement income is modest", () => {
    // Drawing from a high-basis taxable account recognizes very little ordinary
    // income, so the recovery tax never engages. Worth pinning: it is the
    // common case, and a model that clawed back here would be wrong.
    const r = runPath(
      retiree({
        retirementBenefit: {
          system: "canada_cpp_oas",
          claimAge: 65,
          cppMonthlyAt65: 1_300,
          oasMonthlyAt65: 728,
        },
      }),
    );
    const paying = r.years.filter((y) => y.benefitGross > 0);
    expect(paying.length).toBeGreaterThan(0);
    expect(paying.every((y) => y.benefitClawback === 0)).toBe(true);
  });

  it("Canadian OAS is clawed back when retirement income is high", () => {
    // All-tax-advantaged balance: every dollar withdrawn is ordinary income,
    // which is exactly what the recovery tax tests against.
    const r = runPath(
      retiree({
        retirementBenefit: {
          system: "canada_cpp_oas",
          claimAge: 65,
          cppMonthlyAt65: 1_300,
          oasMonthlyAt65: 728,
        },
      }),
    );
    void r;
    const highIncome = runPath(
      baseConfig({
        income: {
          ...baseConfig().income,
          currentAge: 60,
          retirementAge: 62,
          retirementBenefit: {
            system: "canada_cpp_oas",
            claimAge: 65,
            cppMonthlyAt65: 1_300,
            oasMonthlyAt65: 728,
          },
        },
        assets: {
          ...baseConfig().assets,
          currentBalance: 4_000_000,
          accountSplit: { taxAdvantaged: 1, taxable: 0 },
          startingCashBuffer: 0,
        },
        liabilities: {
          ...baseConfig().liabilities,
          baseAnnualExpenses: 200_000,
          retirementIncomeTargetAnnual: 200_000,
        },
        horizonYears: 35,
      }),
    );

    const clawed = highIncome.years.filter((y) => y.benefitClawback > 0);
    expect(clawed.length).toBeGreaterThan(0);
    highIncome.years.forEach((y) => {
      expect(y.benefitNet).toBeCloseTo(y.benefitGross - y.benefitClawback, 6);
      expect(y.benefitClawback).toBeLessThanOrEqual(y.benefitGross + 1e-6);
    });
  });
});

describe("state treatment of Social Security", () => {
  it("is federally taxable but exempt from state tax", () => {
    const ctx = { filingStatus: "single" as const, inflationFactor: 1 };
    const withExempt = computeTax({
      jurisdiction: "nyc",
      wages: 0,
      ordinaryIncome: 80_000,
      stateExemptOrdinaryIncome: 30_000,
      realizedGains: 0,
      ctx,
    });
    const withoutExempt = computeTax({
      jurisdiction: "nyc",
      wages: 0,
      ordinaryIncome: 80_000,
      realizedGains: 0,
      ctx,
    });

    expect(withExempt.federalIncomeTax).toBeCloseTo(
      withoutExempt.federalIncomeTax,
      6,
    );
    expect(withExempt.stateIncomeTax).toBeLessThan(withoutExempt.stateIncomeTax);
  });
});
