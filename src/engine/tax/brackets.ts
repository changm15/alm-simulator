/**
 * Bracket arithmetic shared by every jurisdiction module.
 *
 * All bracket tables in this directory are 2025 figures. They are indexed to
 * inflation at call time via `inflationFactor` — without that, a 30-year
 * simulation silently pushes the user into the top bracket through pure
 * bracket creep, which is a modelling artifact rather than a real outcome.
 *
 * These tables are planning approximations. They ignore credits, phase-outs,
 * itemized deductions, AMT, and every filing status except single and
 * married-filing-jointly. Verify against current law before relying on any
 * number for an actual filing.
 */

export const TAX_TABLE_YEAR = 2025;

/** A bracket applies `rate` to income above `from` and up to the next `from`. */
export interface Bracket {
  from: number;
  rate: number;
}

export function progressiveTax(
  taxableIncome: number,
  brackets: Bracket[],
  inflationFactor = 1,
): number {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const from = brackets[i].from * inflationFactor;
    const to =
      i + 1 < brackets.length ? brackets[i + 1].from * inflationFactor : Infinity;
    if (taxableIncome <= from) break;
    const slice = Math.min(taxableIncome, to) - from;
    tax += slice * brackets[i].rate;
  }
  return tax;
}

/** Marginal rate at a given income level. */
export function marginalRate(
  taxableIncome: number,
  brackets: Bracket[],
  inflationFactor = 1,
): number {
  let rate = brackets[0].rate;
  for (const b of brackets) {
    if (taxableIncome > b.from * inflationFactor) rate = b.rate;
    else break;
  }
  return rate;
}

export interface TaxContext {
  filingStatus: "single" | "married";
  /** Cumulative inflation since the table year; indexes brackets forward. */
  inflationFactor: number;
  /**
   * Ordinary income already recognized this year. States that tax gains as
   * ordinary income need it to stack the gain on the correct brackets;
   * omitting it understates the bill.
   */
  ordinaryIncome?: number;
}

export interface JurisdictionTax {
  readonly id: string;
  readonly label: string;
  /** Tax on ordinary income (wages, pensions, tax-advantaged withdrawals). */
  incomeTax(gross: number, ctx: TaxContext): number;
  /** State/local tax on realized long-term capital gains. */
  capitalGainsTax(realizedGain: number, ctx: TaxContext): number;
  /** State-level payroll-style levies (e.g. CA SDI). Federal FICA is separate. */
  payrollTax?(wages: number, ctx: TaxContext): number;
  /** Human-readable caveats surfaced in the UI. */
  readonly notes: string[];
}
