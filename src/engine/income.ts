/**
 * Income trajectory logic.
 *
 * Returns nominal dollars for a given year, split into wage income (subject to
 * payroll tax) and other income (not).
 *
 * Retirement is modelled as an age rather than a calendar year wherever
 * currentAge is supplied, and it applies on top of ANY trajectory — being on a
 * promotion track and retiring at 60 is the normal case, not a special one.
 *
 * The "schedule" trajectory takes explicit per-year salary figures in nominal
 * dollars and grows at a stated rate past the last one. Everything else in the
 * engine (retirement, relocation pay multipliers, scenario shocks) applies on
 * top of it unchanged.
 */

import { IncomeConfig } from "./types";

export interface IncomeYear {
  wage: number;
  other: number;
  total: number;
  /** True once wage income has permanently stopped — used for the
   *  retirement-income-target floor in the liability stream. */
  wageIncomeEnded: boolean;
}

const DEFAULT_PROMOTION_INTERVAL = 3;
const DEFAULT_PROMOTION_PCT = 15;
const DEFAULT_PROMOTION_CAP_MULTIPLE = 3;

/**
 * The calendar year wage income steps down, from whichever of retirementAge or
 * exitYear is configured. retirementAge wins when both are present.
 */
export function resolveExitYear(cfg: IncomeConfig): number | undefined {
  if (cfg.retirementAge !== undefined && cfg.currentAge !== undefined) {
    return cfg.startYear + (cfg.retirementAge - cfg.currentAge);
  }
  return cfg.exitYear;
}

export function ageInYear(
  cfg: IncomeConfig,
  yearIndex: number,
): number | undefined {
  return cfg.currentAge === undefined ? undefined : cfg.currentAge + yearIndex;
}

/**
 * Real (inflation-excluded) salary multiplier at a given year index, before
 * inflation is layered on. Keeping the promotion track in real terms means a
 * "+15% every 3 years" step is a genuine 15% raise, not 15% minus inflation.
 */
function realSalaryMultiplier(cfg: IncomeConfig, yearIndex: number): number {
  const realGrowth = (cfg.realWageGrowthPct ?? 0) / 100;
  let mult = Math.pow(1 + realGrowth, yearIndex);

  if (cfg.trajectory === "promotion_track") {
    const cap = cfg.promotionCapMultiple ?? DEFAULT_PROMOTION_CAP_MULTIPLE;
    let stepMult = 1;
    if (cfg.promotionSchedule && cfg.promotionSchedule.length > 0) {
      for (const p of cfg.promotionSchedule) {
        if (cfg.startYear + yearIndex >= p.year) {
          stepMult *= 1 + p.increasePct / 100;
        }
      }
    } else {
      const steps = Math.floor(yearIndex / DEFAULT_PROMOTION_INTERVAL);
      stepMult = Math.pow(1 + DEFAULT_PROMOTION_PCT / 100, steps);
    }
    mult *= Math.min(stepMult, cap);
  }

  return mult;
}

/**
 * Nominal salary for a calendar year from an explicit schedule.
 *
 * Before the first entry: the first entry's figure. Between entries: the most
 * recent figure, held flat. After the last: compounded at the stated growth
 * rate. Returns null when there is no schedule to read.
 */
export function scheduledSalary(
  cfg: IncomeConfig,
  year: number,
): number | null {
  const schedule = [...(cfg.salarySchedule ?? [])].sort(
    (a, b) => a.year - b.year,
  );
  if (schedule.length === 0) return null;

  const first = schedule[0];
  const last = schedule[schedule.length - 1];

  if (year <= first.year) return first.salary;
  if (year >= last.year) {
    const growth = (cfg.postScheduleGrowthPct ?? 0) / 100;
    return last.salary * Math.pow(1 + growth, year - last.year);
  }

  let current = first;
  for (const entry of schedule) {
    if (entry.year <= year) current = entry;
  }
  return current.salary;
}

export function incomeForYear(
  cfg: IncomeConfig,
  yearIndex: number,
  inflationFactor: number,
): IncomeYear {
  const year = cfg.startYear + yearIndex;

  // Scheduled figures are already nominal; everything else is a real-terms
  // trajectory that inflation is layered onto.
  const scheduled =
    cfg.trajectory === "schedule" ? scheduledSalary(cfg, year) : null;
  let wage =
    scheduled ??
    cfg.baseSalary * realSalaryMultiplier(cfg, yearIndex) * inflationFactor;
  let wageIncomeEnded = false;

  const exitYear = resolveExitYear(cfg);
  if (exitYear !== undefined && year >= exitYear) {
    const replacementPct = cfg.exitIncomeReplacementPct ?? 0;
    const yearsSinceExit = year - exitYear;
    const withinReplacementWindow =
      cfg.exitReplacementYears === undefined ||
      yearsSinceExit < cfg.exitReplacementYears;
    wage = withinReplacementWindow ? wage * (replacementPct / 100) : 0;
    wageIncomeEnded = wage <= 0;
  }

  let other = 0;
  for (const s of cfg.otherIncomeStreams ?? []) {
    if (year < s.startYear) continue;
    if (s.endYear !== undefined && year > s.endYear) continue;
    const amount =
      s.inflationAdjusted === false
        ? s.annualAmount
        : s.annualAmount * inflationFactor;
    if (s.isWageIncome) wage += amount;
    else other += amount;
  }

  return { wage, other, total: wage + other, wageIncomeEnded };
}
