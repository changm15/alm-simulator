/**
 * Shared types for the ALM cash-flow engine.
 *
 * The four config blocks are deliberately independent: you can swap a
 * ScenarioConfig without touching IncomeConfig, and the sensitivity sweep
 * mutates only AssetConfig.allocation.
 */

import type { RetirementBenefitConfig } from "./benefits";

export type FilingStatus = "single" | "married";

export type Jurisdiction = "seattle" | "nyc" | "jerseycity" | "la";

export type AssetClass =
  | "usEquity"
  | "intlEquity"
  | "usTreasuries"
  | "corporateBonds"
  | "cash";

export const ASSET_CLASSES: AssetClass[] = [
  "usEquity",
  "intlEquity",
  "usTreasuries",
  "corporateBonds",
  "cash",
];

export type Allocation = Record<AssetClass, number>;

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

export interface OtherIncomeStream {
  label: string;
  annualAmount: number;
  startYear: number;
  endYear?: number;
  /** Wage-like income pays payroll tax; pensions/rents do not. */
  isWageIncome?: boolean;
  /** If true the amount is held in real terms and grows with inflation. */
  inflationAdjusted?: boolean;
}

export interface IncomeConfig {
  baseSalary: number;
  /** Your age in startYear. Lets retirement be expressed as an age. */
  currentAge?: number;
  /**
   * Age at which wage income stops. Applies on top of ANY trajectory — you can
   * be on a promotion track and still retire at 60. Requires currentAge.
   * Takes precedence over exitYear.
   */
  retirementAge?: number;
  /** Calendar year the simulation starts. Year index 0 == startYear. */
  startYear: number;
  trajectory: "promotion_track" | "flat" | "early_exit" | "schedule";
  /**
   * schedule only: explicit salary by calendar year, in NOMINAL dollars exactly
   * as entered — no inflation is layered on, because a figure you typed for
   * 2031 is the number you expect to see in 2031.
   *
   * Years between entries hold the most recent value rather than interpolating:
   * if you did not state a number, the model does not invent one. Years after
   * the last entry grow at postScheduleGrowthPct.
   */
  salarySchedule?: { year: number; salary: number }[];
  /** Nominal annual growth applied after the last scheduled year. */
  postScheduleGrowthPct?: number;
  /**
   * promotion_track only. `year` is an absolute calendar year. Omit to use
   * the default cadence (+15% every 3 years, capped by promotionCapMultiple).
   */
  promotionSchedule?: { year: number; increasePct: number }[];
  /** Ceiling on salary as a multiple of baseSalary in real terms. */
  promotionCapMultiple?: number;
  /** Calendar year income steps down. Superseded by retirementAge if set. */
  exitYear?: number;
  /** Fraction of salary retained after the exit year (0 = none). */
  exitIncomeReplacementPct?: number;
  /** Years the replacement income lasts (e.g. severance). Omit = forever. */
  exitReplacementYears?: number;
  otherIncomeStreams?: OtherIncomeStream[];
  /**
   * Government retirement benefit — US Social Security, or Canadian CPP + OAS.
   * An inflation-indexed life annuity that funds part of the liability stream
   * directly, so the portfolio does not have to.
   */
  retirementBenefit?: RetirementBenefitConfig;
  filingStatus: FilingStatus;
  /** Real wage growth on top of inflation, applied every year. */
  realWageGrowthPct?: number;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export interface AssetConfig {
  currentBalance: number;
  allocation: Allocation;
  accountSplit: {
    /** 401k / IRA — ordinary income tax at withdrawal, no tax on gains. */
    taxAdvantaged: number;
    /** Brokerage — capital gains tax on realized gains only. */
    taxable: number;
  };
  /**
   * Share of free cash flow actually invested. The remainder accumulates in a
   * side cash buffer that is drawn down before any portfolio asset is sold.
   * 1.0 = invest everything, no buffer.
   */
  contributionRatePct: number;
  /** Fraction of the STARTING taxable balance that is cost basis. */
  costBasisFraction: number;
  /** Share of new contributions routed to tax-advantaged accounts. */
  taxAdvantagedContributionSharePct?: number;
  /**
   * Annual cap on tax-advantaged contributions (2025 402(g) elective deferral
   * limit is $23,500). Indexed to inflation alongside the bracket tables.
   */
  annualTaxAdvantagedLimit?: number;
  /**
   * True (default) models a traditional 401k/IRA: the contribution is deducted
   * from ordinary income now and taxed on withdrawal. False models a Roth:
   * contributed with after-tax dollars, withdrawn tax free.
   */
  taxAdvantagedContributionsArePreTax?: boolean;
  /** Starting side cash buffer (emergency fund). */
  startingCashBuffer?: number;
}

// ---------------------------------------------------------------------------
// Liabilities
// ---------------------------------------------------------------------------

/**
 * One line of the spending plan. Categories are the planning unit: they inflate
 * at their own rate and respond to a relocation by their own amount, because a
 * move from NYC to Seattle cuts rent a lot and streaming subscriptions not at
 * all.
 */
export interface ExpenseCategory {
  label: string;
  /** Annual amount in today's dollars. */
  annualAmount: number;
  /** Overrides inflationAssumptionPct — healthcare and childcare run hotter. */
  inflationPct?: number;
  /**
   * 0–1: how much of this category tracks local cost of living. Housing ~1.0,
   * groceries ~0.6, a car payment ~0.2, subscriptions 0. Applied against a
   * relocation's expenseLevelMultiplier.
   */
  colSensitivity?: number;
  /**
   * Essential spending continues after wage income stops; non-essential
   * spending is subject to postExitDiscretionaryCutPct.
   */
  essential?: boolean;
}

export interface LiabilityConfig {
  /**
   * Total base spending. Ignored when expenseCategories is set — the sum of
   * the categories is used instead.
   */
  baseAnnualExpenses: number;
  inflationAssumptionPct: number;
  /** The itemized spending plan. Takes precedence over baseAnnualExpenses. */
  expenseCategories?: ExpenseCategory[];
  /**
   * Percentage cut applied to non-essential categories once wage income stops.
   * Models belt-tightening in retirement.
   */
  postExitDiscretionaryCutPct?: number;
  recurringLiabilities?: {
    label: string;
    annualAmount: number;
    startYear: number;
    endYear?: number;
    /** Default true: the amount is real and inflates. */
    inflationAdjusted?: boolean;
  }[];
  oneTimeLiabilities?: { label: string; year: number; amount: number }[];
  /**
   * Real annual spend the portfolio must fund once wage income stops. Once
   * income ends, expenses are floored at this (inflated) amount.
   */
  retirementIncomeTargetAnnual?: number;
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export interface RelocationEvent {
  year: number;
  toJurisdiction: Jurisdiction;
  expenseLevelMultiplier?: number;
  incomeMultiplier?: number;
}

export interface ScenarioConfig {
  marketPath: "optimistic" | "base" | "pessimistic";
  /** Calendar year of a sharp drawdown, if any. */
  shockYear?: number;
  /** e.g. -30 for a 30% equity drawdown. */
  shockMagnitudePct?: number;
  correlatedStressPreset?:
    | "recession_plus_layoff"
    | "recession_plus_expense_shock"
    | null;
  relocationEvents?: RelocationEvent[];
  /** Independent (uncorrelated) events the user layered on by hand. */
  manualIncomeShock?: { year: number; incomeMultiplier: number; years: number };
  manualExpenseShock?: { year: number; amount: number };
}

// ---------------------------------------------------------------------------
// Simulation wiring
// ---------------------------------------------------------------------------

export interface SimulationConfig {
  income: IncomeConfig;
  assets: AssetConfig;
  liabilities: LiabilityConfig;
  scenario: ScenarioConfig;
  /** Number of simulated years. */
  horizonYears: number;
  /** Jurisdiction before any relocation event fires. */
  startJurisdiction: Jurisdiction;
  /** Deterministic mode uses expected returns with no volatility draw. */
  deterministic?: boolean;
  /**
   * Deterministic runs only: correct for volatility drag so the single path
   * approximates the MEDIAN outcome rather than the mean-return outcome.
   */
  medianAdjusted?: boolean;
  seed?: number;
}

export interface YearResult {
  year: number;
  yearIndex: number;
  /** Your age that year, when currentAge is configured. */
  age?: number;
  jurisdiction: Jurisdiction;
  grossWageIncome: number;
  otherIncome: number;
  /** Government benefit before any clawback. */
  benefitGross: number;
  /** OAS recovery tax withheld; always 0 for US Social Security. */
  benefitClawback: number;
  /** Benefit cash actually received. */
  benefitNet: number;
  /** Portion of the benefit included in ordinary taxable income. */
  benefitTaxable: number;
  /** Cash income: wages + other + benefit received. */
  totalIncome: number;
  expenses: number;
  /** Per-category expense detail for the year, in nominal dollars. */
  expenseBreakdown: { label: string; amount: number }[];
  /** Ordinary income tax + payroll tax + capital gains tax for the year. */
  totalTax: number;
  incomeTax: number;
  payrollTax: number;
  capitalGainsTax: number;
  /** income - expenses - taxes, before any portfolio movement. */
  /** Income actually exposed to ordinary income tax, after any pre-tax deferral. */
  ordinaryTaxableIncome: number;
  freeCashFlow: number;
  contribution: number;
  /** Pre-tax (or Roth) contribution routed to the tax-advantaged account. */
  taxAdvantagedContribution: number;
  taxableContribution: number;
  withdrawal: number;
  realizedGains: number;
  taxAdvantagedWithdrawal: number;
  blendedReturnPct: number;
  /** Dollar market gain/loss for the year, before any contribution or sale. */
  investmentGain: number;
  cashBuffer: number;
  taxableBalance: number;
  taxableBasis: number;
  /** Embedded gain in the taxable account: balance − basis. */
  unrealizedGain: number;
  taxAdvantagedBalance: number;
  /** taxable + taxAdvantaged (excludes the side cash buffer). */
  portfolioBalance: number;
  /** portfolio + cash buffer. */
  netWorth: number;
  /** True if the year's spending could not be fully funded. */
  shortfall: boolean;
  shortfallAmount: number;
}

export interface PathResult {
  years: YearResult[];
  terminalNetWorth: number;
  /** Lifetime totals — the "where did the money come from" decomposition. */
  totalContributions: number;
  totalWithdrawals: number;
  totalInvestmentGain: number;
  totalTaxPaid: number;
  totalRealizedGains: number;
  totalCapitalGainsTax: number;
  totalBenefitsReceived: number;
  /** Money-weighted annualized return on the portfolio over the horizon. */
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  /** First year index where funding failed, or null. */
  firstShortfallYearIndex: number | null;
  totalShortfall: number;
}
