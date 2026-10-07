import { Jurisdiction } from "../types";
import { JurisdictionTax, TaxContext } from "./brackets";
import {
  federalCapitalGainsTax,
  federalIncomeTax,
  federalPayrollTax,
  federalStandardDeduction,
} from "./federal";
import { seattle } from "./seattle";
import { nyc } from "./nyc";
import { jerseycity } from "./jerseycity";
import { la } from "./la";

export * from "./brackets";
export * from "./federal";
export { seattle, nyc, jerseycity, la };

export const JURISDICTIONS: Record<Jurisdiction, JurisdictionTax> = {
  seattle,
  nyc,
  jerseycity,
  la,
};

export interface TaxBill {
  incomeTax: number;
  payrollTax: number;
  capitalGainsTax: number;
  total: number;
  federalIncomeTax: number;
  stateIncomeTax: number;
  federalCapitalGainsTax: number;
  stateCapitalGainsTax: number;
}

export interface TaxInput {
  jurisdiction: Jurisdiction;
  /** Wages only — the base for payroll tax. */
  wages: number;
  /**
   * All ordinary income: wages, other non-wage ordinary income, and
   * tax-advantaged account withdrawals (taxed as ordinary income at
   * withdrawal, NOT as capital gains).
   */
  ordinaryIncome: number;
  /** Realized long-term gains from taxable-account sales only. */
  realizedGains: number;
  /**
   * Part of ordinaryIncome that is federally taxable but exempt from STATE
   * tax. US Social Security is exempt in all four modelled jurisdictions;
   * taxing it at the state level would overstate the bill every year of
   * retirement.
   */
  stateExemptOrdinaryIncome?: number;
  ctx: TaxContext;
}

export function computeTax(input: TaxInput): TaxBill {
  const j = JURISDICTIONS[input.jurisdiction];
  const ctx = { ...input.ctx, ordinaryIncome: input.ordinaryIncome };

  const fedIncome = federalIncomeTax(input.ordinaryIncome, ctx);
  const stateBase = Math.max(
    0,
    input.ordinaryIncome - (input.stateExemptOrdinaryIncome ?? 0),
  );
  const stateIncome = j.incomeTax(stateBase, ctx);

  // Federal LTCG stacks on federal TAXABLE income (after the standard
  // deduction), not on gross.
  const fedOrdinaryTaxable = Math.max(
    0,
    input.ordinaryIncome - federalStandardDeduction(ctx),
  );
  const fedCg = federalCapitalGainsTax(
    input.realizedGains,
    fedOrdinaryTaxable,
    ctx,
  );
  const stateCg = j.capitalGainsTax(input.realizedGains, ctx);

  const payroll =
    federalPayrollTax(input.wages, ctx) + (j.payrollTax?.(input.wages, ctx) ?? 0);

  const incomeTax = fedIncome + stateIncome;
  const capitalGainsTax = fedCg + stateCg;

  return {
    incomeTax,
    payrollTax: payroll,
    capitalGainsTax,
    total: incomeTax + payroll + capitalGainsTax,
    federalIncomeTax: fedIncome,
    stateIncomeTax: stateIncome,
    federalCapitalGainsTax: fedCg,
    stateCapitalGainsTax: stateCg,
  };
}
