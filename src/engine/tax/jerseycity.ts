/**
 * Jersey City, NJ.
 *
 * NJ has no local income tax, so this is state-only. NJ taxes capital gains as
 * ordinary income — no preferential rate — and has no standard deduction
 * (a personal exemption instead).
 */

import { Bracket, JurisdictionTax, TaxContext, progressiveTax } from "./brackets";

const NJ_SINGLE: Bracket[] = [
  { from: 0, rate: 0.014 },
  { from: 20_000, rate: 0.0175 },
  { from: 35_000, rate: 0.035 },
  { from: 40_000, rate: 0.05525 },
  { from: 75_000, rate: 0.0637 },
  { from: 500_000, rate: 0.0897 },
  { from: 1_000_000, rate: 0.1075 },
];

const NJ_MARRIED: Bracket[] = [
  { from: 0, rate: 0.014 },
  { from: 20_000, rate: 0.0175 },
  { from: 50_000, rate: 0.0245 },
  { from: 70_000, rate: 0.035 },
  { from: 80_000, rate: 0.05525 },
  { from: 150_000, rate: 0.0637 },
  { from: 500_000, rate: 0.0897 },
  { from: 1_000_000, rate: 0.1075 },
];

/** NJ personal exemption, in lieu of a standard deduction. */
const NJ_EXEMPTION = { single: 1_000, married: 2_000 };

function njTax(gross: number, ctx: TaxContext): number {
  const taxable = Math.max(
    0,
    gross - NJ_EXEMPTION[ctx.filingStatus] * ctx.inflationFactor,
  );
  return progressiveTax(
    taxable,
    ctx.filingStatus === "single" ? NJ_SINGLE : NJ_MARRIED,
    ctx.inflationFactor,
  );
}

export const jerseycity: JurisdictionTax = {
  id: "jerseycity",
  label: "Jersey City, NJ",

  incomeTax(gross: number, ctx: TaxContext): number {
    return njTax(gross, ctx);
  },

  capitalGainsTax(realizedGain: number, ctx: TaxContext): number {
    if (realizedGain <= 0) return 0;
    const ord = Math.max(0, ctx.ordinaryIncome ?? 0);
    return njTax(ord + realizedGain, ctx) - njTax(ord, ctx);
  },

  notes: [
    "No local (Jersey City) income tax; NJ state tax only.",
    "NJ taxes capital gains as ordinary income at the regular brackets.",
    "Assumes NJ residency, not a NY-source-income credit situation — a Jersey City resident working in NYC pays NY nonresident tax with an NJ credit, which this model does not compute.",
    "Ignores NJ unemployment/disability/family-leave payroll contributions.",
  ],
};
