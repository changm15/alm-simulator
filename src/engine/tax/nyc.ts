/**
 * New York City, NY — NY State tax plus the NYC resident income tax.
 *
 * NY taxes capital gains as ordinary income at the regular brackets; there is
 * no preferential state rate.
 */

import { Bracket, JurisdictionTax, TaxContext, progressiveTax } from "./brackets";

const NY_SINGLE: Bracket[] = [
  { from: 0, rate: 0.04 },
  { from: 8_500, rate: 0.045 },
  { from: 11_700, rate: 0.0525 },
  { from: 13_900, rate: 0.055 },
  { from: 80_650, rate: 0.06 },
  { from: 215_400, rate: 0.0685 },
  { from: 1_077_550, rate: 0.0965 },
  { from: 5_000_000, rate: 0.103 },
  { from: 25_000_000, rate: 0.109 },
];

const NY_MARRIED: Bracket[] = [
  { from: 0, rate: 0.04 },
  { from: 17_150, rate: 0.045 },
  { from: 23_600, rate: 0.0525 },
  { from: 27_900, rate: 0.055 },
  { from: 161_550, rate: 0.06 },
  { from: 323_200, rate: 0.0685 },
  { from: 2_155_350, rate: 0.0965 },
  { from: 5_000_000, rate: 0.103 },
  { from: 25_000_000, rate: 0.109 },
];

const NY_STANDARD_DEDUCTION = { single: 8_000, married: 16_050 };

const NYC_SINGLE: Bracket[] = [
  { from: 0, rate: 0.03078 },
  { from: 12_000, rate: 0.03762 },
  { from: 25_000, rate: 0.03819 },
  { from: 50_000, rate: 0.03876 },
];

const NYC_MARRIED: Bracket[] = [
  { from: 0, rate: 0.03078 },
  { from: 21_600, rate: 0.03762 },
  { from: 45_000, rate: 0.03819 },
  { from: 90_000, rate: 0.03876 },
];

function nyTaxable(gross: number, ctx: TaxContext): number {
  return Math.max(
    0,
    gross - NY_STANDARD_DEDUCTION[ctx.filingStatus] * ctx.inflationFactor,
  );
}

function combined(gross: number, ctx: TaxContext): number {
  const taxable = nyTaxable(gross, ctx);
  const state = progressiveTax(
    taxable,
    ctx.filingStatus === "single" ? NY_SINGLE : NY_MARRIED,
    ctx.inflationFactor,
  );
  const city = progressiveTax(
    taxable,
    ctx.filingStatus === "single" ? NYC_SINGLE : NYC_MARRIED,
    ctx.inflationFactor,
  );
  return state + city;
}

export const nyc: JurisdictionTax = {
  id: "nyc",
  label: "New York City, NY",

  incomeTax(gross: number, ctx: TaxContext): number {
    return combined(gross, ctx);
  },

  /**
   * Gains stack on top of ordinary income, so the state tax attributable to
   * the gain is the difference between the bill with and without it.
   */
  capitalGainsTax(realizedGain: number, ctx: TaxContext): number {
    if (realizedGain <= 0) return 0;
    const ord = Math.max(0, ctx.ordinaryIncome ?? 0);
    return combined(ord + realizedGain, ctx) - combined(ord, ctx);
  },

  notes: [
    "NY State plus NYC resident income tax; capital gains are taxed as ordinary income at both levels.",
    "Ignores NY household/dependent credits and the NYC school tax credit.",
  ],
};

/** Exposed so the cash-flow loop can stack gains on top of ordinary income. */
export function nycCombinedOrdinaryTax(gross: number, ctx: TaxContext): number {
  return combined(gross, ctx);
}
