/**
 * Seattle, WA.
 *
 * The trap this module exists to avoid: WA has no wage income tax, so it is
 * easy to model it as "zero tax". But since 2022 WA levies a 7% excise tax on
 * long-term capital gains above an annually indexed standard deduction
 * (~$270,000 for 2025), with an additional surcharge on very large gains.
 * Retirement accounts and real estate are excluded. So a Seattle relocation
 * cuts ordinary income tax to zero but does NOT cut capital gains tax to zero
 * once a taxable-account drawdown gets large.
 */

import { JurisdictionTax, TaxContext } from "./brackets";

const WA_CG_RATE = 0.07;
const WA_CG_STANDARD_DEDUCTION = 270_000;
/** Surcharge on gains above $1M, effective 2025. */
const WA_CG_SURCHARGE_RATE = 0.029;
const WA_CG_SURCHARGE_THRESHOLD = 1_000_000;

export const seattle: JurisdictionTax = {
  id: "seattle",
  label: "Seattle, WA",

  incomeTax() {
    return 0;
  },

  capitalGainsTax(realizedGain: number, ctx: TaxContext): number {
    if (realizedGain <= 0) return 0;
    const deduction = WA_CG_STANDARD_DEDUCTION * ctx.inflationFactor;
    const taxable = Math.max(0, realizedGain - deduction);
    if (taxable <= 0) return 0;
    const surchargeBase = Math.max(
      0,
      realizedGain - WA_CG_SURCHARGE_THRESHOLD * ctx.inflationFactor,
    );
    return taxable * WA_CG_RATE + surchargeBase * WA_CG_SURCHARGE_RATE;
  },

  notes: [
    "No state income tax on wages.",
    `7% state excise tax on long-term capital gains above ~$${WA_CG_STANDARD_DEDUCTION.toLocaleString()} (indexed), plus a 2.9% surcharge above $1M.`,
    "Retirement-account withdrawals and real estate are excluded from the WA capital gains excise tax.",
    "Ignores WA Paid Family & Medical Leave and Cares Fund premiums.",
  ],
};
