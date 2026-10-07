import { SimulationConfig, Allocation } from "../types";

export const BALANCED: Allocation = {
  usEquity: 0.45,
  intlEquity: 0.15,
  usTreasuries: 0.2,
  corporateBonds: 0.15,
  cash: 0.05,
};

export function baseConfig(
  overrides: Partial<SimulationConfig> = {},
): SimulationConfig {
  return {
    income: {
      baseSalary: 200_000,
      startYear: 2026,
      trajectory: "flat",
      filingStatus: "single",
    },
    assets: {
      currentBalance: 400_000,
      allocation: BALANCED,
      accountSplit: { taxAdvantaged: 0.4, taxable: 0.6 },
      contributionRatePct: 100,
      costBasisFraction: 0.7,
      taxAdvantagedContributionSharePct: 25,
      startingCashBuffer: 0,
    },
    liabilities: {
      baseAnnualExpenses: 90_000,
      inflationAssumptionPct: 2.5,
    },
    scenario: { marketPath: "base" },
    horizonYears: 30,
    startJurisdiction: "nyc",
    deterministic: true,
    seed: 42,
    ...overrides,
  };
}

/** A decumulation setup: income stops early, the portfolio funds the rest. */
export function retireeConfig(
  overrides: Partial<SimulationConfig> = {},
): SimulationConfig {
  const base = baseConfig();
  return {
    ...base,
    income: {
      ...base.income,
      trajectory: "early_exit",
      exitYear: 2027,
      exitIncomeReplacementPct: 0,
    },
    assets: {
      ...base.assets,
      currentBalance: 4_000_000,
      startingCashBuffer: 0,
    },
    liabilities: {
      ...base.liabilities,
      baseAnnualExpenses: 120_000,
      retirementIncomeTargetAnnual: 120_000,
    },
    horizonYears: 30,
    ...overrides,
  };
}
