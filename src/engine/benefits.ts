/**
 * Government retirement benefits: US Social Security, or Canadian CPP + OAS.
 *
 * These matter to an ALM model for one reason: they are an inflation-indexed
 * life annuity that funds part of the liability stream directly, so the
 * portfolio does not have to. Leaving them out overstates required drawdown
 * badly — and the claiming decision is one of the few genuinely large levers a
 * person still controls at that point.
 *
 * Three mechanisms are modelled rather than hand-waved:
 *
 *  1. CLAIMING ADJUSTMENTS. Benefits are actuarially reduced for claiming early
 *     and increased for claiming late, on published schedules.
 *
 *  2. THE US TAXABLE-PORTION FORMULA. Up to 85% of a Social Security benefit is
 *     federally taxable depending on "provisional income". The thresholds in
 *     that test have been fixed in nominal dollars since 1984 and are NOT
 *     indexed, so an ever-larger share of benefits becomes taxable over a long
 *     plan. That is a real effect and the model reproduces it deliberately —
 *     see the test that pins it.
 *
 *  3. THE OAS RECOVERY TAX. Canadian OAS is clawed back at 15% of net income
 *     above an indexed threshold, which can erase the benefit entirely for a
 *     high-income retiree.
 *
 * All amounts are entered in today's dollars; both systems are indexed, so they
 * are inflated alongside everything else.
 */

import { FilingStatus } from "./types";

export type BenefitSystem = "none" | "us_social_security" | "canada_cpp_oas";

export interface RetirementBenefitConfig {
  system: BenefitSystem;
  /** Age benefits start. US: 62–70. CPP: 60–70. OAS: 65–70. */
  claimAge: number;

  // --- US Social Security ---
  /** Monthly benefit at full retirement age, in today's dollars (the PIA). */
  monthlyAtFullRetirementAge?: number;
  /** 67 for anyone born 1960 or later. */
  fullRetirementAge?: number;

  // --- Canada ---
  /** Monthly CPP at 65, today's dollars. 2025 maximum is about $1,433. */
  cppMonthlyAt65?: number;
  /** Monthly OAS at 65, today's dollars. 2025 figure is about $728. */
  oasMonthlyAt65?: number;
}

export const DEFAULT_FRA = 67;

/** 2025 maxima, for the UI to show as reference points. */
export const BENEFIT_REFERENCE = {
  usMaxMonthlyAtFra: 4018,
  usAverageMonthly: 1976,
  cppMaxMonthlyAt65: 1433,
  cppAverageMonthlyAt65: 900,
  oasMonthlyAt65: 727.67,
};

/**
 * Social Security claiming factor.
 *
 * Early: 5/9 of 1% per month for the first 36 months before FRA, then 5/12 of
 * 1% for each further month. Late: 2/3 of 1% per month (8% a year) to age 70,
 * after which nothing more accrues.
 */
export function socialSecurityFactor(claimAge: number, fra = DEFAULT_FRA): number {
  const capped = Math.min(Math.max(claimAge, 62), 70);
  const months = Math.round((capped - fra) * 12);

  if (months < 0) {
    const early = -months;
    const first = Math.min(early, 36);
    const beyond = Math.max(0, early - 36);
    return 1 - (first * 5) / 900 - (beyond * 5) / 1200;
  }
  // Delayed credits stop accruing at 70 even if FRA is later.
  const creditMonths = Math.min(months, Math.round((70 - fra) * 12));
  return 1 + (creditMonths * 2) / 300;
}

/** CPP: −0.6% per month before 65, +0.7% per month after, 60–70. */
export function cppFactor(claimAge: number): number {
  const capped = Math.min(Math.max(claimAge, 60), 70);
  const months = Math.round((capped - 65) * 12);
  return months < 0 ? 1 + months * 0.006 : 1 + months * 0.007;
}

/** OAS: no early claiming; +0.6% per month deferred past 65, to 70. */
export function oasFactor(claimAge: number): number {
  const capped = Math.min(Math.max(claimAge, 65), 70);
  return 1 + Math.round((capped - 65) * 12) * 0.006;
}

/**
 * Federally taxable portion of a US Social Security benefit.
 *
 * `otherOrdinaryIncome` is everything else recognized this year — wages,
 * pensions, tax-advantaged withdrawals, realized gains. Thresholds are
 * deliberately NOT inflated: they are fixed in statute.
 */
const SS_BASE_1 = { single: 25_000, married: 32_000 };
const SS_BASE_2 = { single: 34_000, married: 44_000 };

export function socialSecurityTaxablePortion(
  benefit: number,
  otherOrdinaryIncome: number,
  filingStatus: FilingStatus,
): number {
  if (benefit <= 0) return 0;
  const b1 = SS_BASE_1[filingStatus];
  const b2 = SS_BASE_2[filingStatus];
  const provisional = Math.max(0, otherOrdinaryIncome) + benefit * 0.5;

  if (provisional <= b1) return 0;
  if (provisional <= b2) {
    return Math.min((provisional - b1) * 0.5, benefit * 0.5);
  }
  const tier1 = Math.min((b2 - b1) * 0.5, benefit * 0.5);
  return Math.min((provisional - b2) * 0.85 + tier1, benefit * 0.85);
}

/** OAS recovery tax: 15% of net income above an indexed threshold. */
export const OAS_CLAWBACK_THRESHOLD_2025 = 93_454;
export const OAS_CLAWBACK_RATE = 0.15;
/** OAS rises about 10% at 75. */
export const OAS_AGE_75_UPLIFT = 1.1;

export function oasClawback(
  oasAnnual: number,
  netIncome: number,
  inflationFactor: number,
): number {
  if (oasAnnual <= 0) return 0;
  const threshold = OAS_CLAWBACK_THRESHOLD_2025 * inflationFactor;
  const excess = Math.max(0, netIncome - threshold);
  return Math.min(oasAnnual, excess * OAS_CLAWBACK_RATE);
}

export interface BenefitYear {
  /** Cash before any clawback, nominal. */
  gross: number;
  /** OAS recovery tax withheld. Always 0 for US Social Security. */
  clawback: number;
  /** Cash actually received. */
  net: number;
  /** Portion included in ordinary taxable income. */
  taxable: number;
  /**
   * Portion that is federally taxable but exempt from STATE tax. US Social
   * Security is exempt in all four modelled jurisdictions; CPP/OAS is not.
   */
  stateExempt: number;
  label: string;
}

const EMPTY: BenefitYear = {
  gross: 0,
  clawback: 0,
  net: 0,
  taxable: 0,
  stateExempt: 0,
  label: "",
};

export function benefitForYear(
  cfg: RetirementBenefitConfig | undefined,
  age: number | undefined,
  inflationFactor: number,
  otherOrdinaryIncome: number,
  filingStatus: FilingStatus,
): BenefitYear {
  if (!cfg || cfg.system === "none" || age === undefined) return EMPTY;
  if (age < cfg.claimAge) return EMPTY;

  if (cfg.system === "us_social_security") {
    const monthly = cfg.monthlyAtFullRetirementAge ?? 0;
    const fra = cfg.fullRetirementAge ?? DEFAULT_FRA;
    const gross =
      monthly * 12 * socialSecurityFactor(cfg.claimAge, fra) * inflationFactor;
    const taxable = socialSecurityTaxablePortion(
      gross,
      otherOrdinaryIncome,
      filingStatus,
    );
    return {
      gross,
      clawback: 0,
      net: gross,
      taxable,
      // Every jurisdiction modelled here exempts Social Security from state tax.
      stateExempt: taxable,
      label: "Social Security",
    };
  }

  // Canada: CPP plus OAS, each on its own claiming schedule.
  const cpp =
    (cfg.cppMonthlyAt65 ?? 0) * 12 * cppFactor(cfg.claimAge) * inflationFactor;
  const oasBase =
    (cfg.oasMonthlyAt65 ?? 0) * 12 * oasFactor(Math.max(65, cfg.claimAge));
  const oas =
    age >= 75
      ? oasBase * OAS_AGE_75_UPLIFT * inflationFactor
      : oasBase * inflationFactor;
  const startedOas = age >= Math.max(65, cfg.claimAge);
  const oasPaid = startedOas ? oas : 0;

  const gross = cpp + oasPaid;
  // The clawback test runs on income including the benefits themselves.
  const clawback = oasClawback(
    oasPaid,
    otherOrdinaryIncome + gross,
    inflationFactor,
  );
  const net = gross - clawback;

  return {
    gross,
    clawback,
    net,
    // CPP and OAS are ordinary income in full; the clawback has already
    // removed what is recovered.
    taxable: net,
    stateExempt: 0,
    label: startedOas ? "CPP + OAS" : "CPP",
  };
}
