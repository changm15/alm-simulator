/**
 * Federal income, payroll, and capital gains tax. Applies in every
 * jurisdiction; the state modules layer on top of this.
 */

import { Bracket, TaxContext, progressiveTax } from "./brackets";

const ORDINARY_SINGLE: Bracket[] = [
  { from: 0, rate: 0.1 },
  { from: 11_925, rate: 0.12 },
  { from: 48_475, rate: 0.22 },
  { from: 103_350, rate: 0.24 },
  { from: 197_300, rate: 0.32 },
  { from: 250_525, rate: 0.35 },
  { from: 626_350, rate: 0.37 },
];

const ORDINARY_MARRIED: Bracket[] = [
  { from: 0, rate: 0.1 },
  { from: 23_850, rate: 0.12 },
  { from: 96_950, rate: 0.22 },
  { from: 206_700, rate: 0.24 },
  { from: 394_600, rate: 0.32 },
  { from: 501_050, rate: 0.35 },
  { from: 751_600, rate: 0.37 },
];

const STANDARD_DEDUCTION = { single: 15_000, married: 30_000 };

/** Long-term capital gains brackets, keyed off total taxable income. */
const LTCG_SINGLE: Bracket[] = [
  { from: 0, rate: 0 },
  { from: 48_350, rate: 0.15 },
  { from: 533_400, rate: 0.2 },
];

const LTCG_MARRIED: Bracket[] = [
  { from: 0, rate: 0 },
  { from: 96_700, rate: 0.15 },
  { from: 600_050, rate: 0.2 },
];

/** Net investment income tax — 3.8% on investment income above the threshold. */
const NIIT_RATE = 0.038;
const NIIT_THRESHOLD = { single: 200_000, married: 250_000 };

/** FICA, 2025. */
const SS_RATE = 0.062;
const SS_WAGE_BASE = 176_100;
const MEDICARE_RATE = 0.0145;
const ADDL_MEDICARE_RATE = 0.009;
const ADDL_MEDICARE_THRESHOLD = { single: 200_000, married: 250_000 };

export function federalStandardDeduction(ctx: TaxContext): number {
  return STANDARD_DEDUCTION[ctx.filingStatus] * ctx.inflationFactor;
}

export function federalOrdinaryBrackets(ctx: TaxContext): Bracket[] {
  return ctx.filingStatus === "single" ? ORDINARY_SINGLE : ORDINARY_MARRIED;
}

export function federalIncomeTax(grossOrdinary: number, ctx: TaxContext): number {
  const taxable = Math.max(0, grossOrdinary - federalStandardDeduction(ctx));
  return progressiveTax(taxable, federalOrdinaryBrackets(ctx), ctx.inflationFactor);
}

/**
 * Long-term capital gains are stacked ON TOP of ordinary taxable income, so
 * the rate depends on the ordinary income in the same year. Treating gains in
 * isolation is the classic way to understate this.
 */
export function federalCapitalGainsTax(
  realizedGain: number,
  ordinaryTaxableIncome: number,
  ctx: TaxContext,
): number {
  if (realizedGain <= 0) return 0;
  const brackets = ctx.filingStatus === "single" ? LTCG_SINGLE : LTCG_MARRIED;
  const base = Math.max(0, ordinaryTaxableIncome);
  const stacked = progressiveTax(base + realizedGain, brackets, ctx.inflationFactor);
  const baseOnly = progressiveTax(base, brackets, ctx.inflationFactor);
  const ltcg = stacked - baseOnly;

  const magi = base + realizedGain;
  const threshold = NIIT_THRESHOLD[ctx.filingStatus] * ctx.inflationFactor;
  const niitBase = Math.min(realizedGain, Math.max(0, magi - threshold));
  return ltcg + niitBase * NIIT_RATE;
}

export function federalPayrollTax(wages: number, ctx: TaxContext): number {
  if (wages <= 0) return 0;
  const ssBase = SS_WAGE_BASE * ctx.inflationFactor;
  const ss = Math.min(wages, ssBase) * SS_RATE;
  const medicare = wages * MEDICARE_RATE;
  const addlThreshold =
    ADDL_MEDICARE_THRESHOLD[ctx.filingStatus] * ctx.inflationFactor;
  const addl = Math.max(0, wages - addlThreshold) * ADDL_MEDICARE_RATE;
  return ss + medicare + addl;
}
