/**
 * Los Angeles, CA.
 *
 * No city income tax; CA state only. CA taxes capital gains as ordinary income.
 * CA SDI applies to all wages with no wage cap (since 2024).
 */

import { Bracket, JurisdictionTax, TaxContext, progressiveTax } from "./brackets";

const CA_SINGLE: Bracket[] = [
  { from: 0, rate: 0.01 },
  { from: 10_756, rate: 0.02 },
  { from: 25_499, rate: 0.04 },
  { from: 40_245, rate: 0.06 },
  { from: 55_866, rate: 0.08 },
  { from: 70_606, rate: 0.093 },
  { from: 360_659, rate: 0.103 },
  { from: 432_787, rate: 0.113 },
  { from: 721_314, rate: 0.123 },
];

const CA_MARRIED: Bracket[] = CA_SINGLE.map((b) => ({
  from: b.from * 2,
  rate: b.rate,
}));

const CA_STANDARD_DEDUCTION = { single: 5_540, married: 11_080 };

/** Mental Health Services Act surcharge on income above $1M. */
const CA_MHSA_RATE = 0.01;
const CA_MHSA_THRESHOLD = 1_000_000;

/** CA State Disability Insurance — no wage cap since 2024. */
const CA_SDI_RATE = 0.012;

function caTax(gross: number, ctx: TaxContext): number {
  const taxable = Math.max(
    0,
    gross - CA_STANDARD_DEDUCTION[ctx.filingStatus] * ctx.inflationFactor,
  );
  const base = progressiveTax(
    taxable,
    ctx.filingStatus === "single" ? CA_SINGLE : CA_MARRIED,
    ctx.inflationFactor,
  );
  const mhsa =
    Math.max(0, taxable - CA_MHSA_THRESHOLD * ctx.inflationFactor) * CA_MHSA_RATE;
  return base + mhsa;
}

export const la: JurisdictionTax = {
  id: "la",
  label: "Los Angeles, CA",

  incomeTax(gross: number, ctx: TaxContext): number {
    return caTax(gross, ctx);
  },

  capitalGainsTax(realizedGain: number, ctx: TaxContext): number {
    if (realizedGain <= 0) return 0;
    const ord = Math.max(0, ctx.ordinaryIncome ?? 0);
    return caTax(ord + realizedGain, ctx) - caTax(ord, ctx);
  },

  payrollTax(wages: number): number {
    return Math.max(0, wages) * CA_SDI_RATE;
  },

  notes: [
    "No city income tax in Los Angeles; CA state tax only.",
    "CA taxes capital gains as ordinary income, plus the 1% MHSA surcharge above $1M.",
    "CA SDI is 1.2% of all wages with no cap (since 2024).",
    "Ignores CA renter's credit and exemption credits.",
  ],
};
