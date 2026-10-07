/**
 * Liability / expense stream.
 *
 * Everything is quoted in real terms in the config and inflated here, so an
 * "80k lifestyle" stays an 80k lifestyle in year 25.
 *
 * Spending is planned as CATEGORIES. That matters for more than presentation:
 *  - each category inflates at its own rate (healthcare and childcare run well
 *    above headline CPI, so a single blended rate quietly understates them);
 *  - each category responds to a relocation by its own amount, because moving
 *    from NYC to Seattle cuts rent a lot and streaming subscriptions not at all;
 *  - non-essential categories can be cut once wage income stops, which is what
 *    most people actually do in retirement.
 */

import { ExpenseCategory, LiabilityConfig } from "./types";

export interface ExpenseYear {
  base: number;
  recurring: number;
  oneTime: number;
  total: number;
  /** Line-item breakdown, in nominal dollars, for the ledger and charts. */
  items: { label: string; amount: number }[];
}

/**
 * An illustrative starting plan, in deliberately round numbers — this is the
 * first thing a stranger sees on the public build, so it should read as an
 * example rather than as somebody's actual budget. Sums to $60,000.
 */
export const DEFAULT_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { label: "Housing", annualAmount: 24_000, colSensitivity: 1.0, essential: true },
  {
    label: "Food & groceries",
    annualAmount: 9_000,
    colSensitivity: 0.6,
    essential: true,
  },
  {
    label: "Transportation",
    annualAmount: 6_000,
    colSensitivity: 0.4,
    essential: true,
  },
  {
    label: "Healthcare",
    annualAmount: 6_000,
    inflationPct: 4.5,
    colSensitivity: 0.3,
    essential: true,
  },
  {
    label: "Insurance & other fixed",
    annualAmount: 4_000,
    colSensitivity: 0.2,
    essential: true,
  },
  {
    label: "Travel & discretionary",
    annualAmount: 8_000,
    colSensitivity: 0.3,
    essential: false,
  },
  {
    label: "Everything else",
    annualAmount: 3_000,
    colSensitivity: 0.3,
    essential: false,
  },
];

export function inflationFactor(
  cfg: LiabilityConfig,
  yearIndex: number,
): number {
  return Math.pow(1 + cfg.inflationAssumptionPct / 100, yearIndex);
}

/** Total base spend in today's dollars, from categories if present. */
export function baseSpend(cfg: LiabilityConfig): number {
  if (cfg.expenseCategories && cfg.expenseCategories.length > 0) {
    return cfg.expenseCategories.reduce((a, c) => a + c.annualAmount, 0);
  }
  return cfg.baseAnnualExpenses;
}

/**
 * A relocation multiplier of 0.8 applied to a category with colSensitivity 0.6
 * moves that category to 0.88, not 0.8 — only the sensitive share of the
 * spending actually tracks the local cost of living.
 */
function applyColSensitivity(multiplier: number, sensitivity: number): number {
  return 1 + (multiplier - 1) * sensitivity;
}

export function expensesForYear(
  cfg: LiabilityConfig,
  yearIndex: number,
  startYear: number,
  opts: {
    /** Cost-of-living multiplier from an active relocation. */
    expenseMultiplier: number;
    /** True once wage income has stopped, which triggers the funding floor. */
    wageIncomeEnded: boolean;
    /** Extra one-time expense injected by a scenario event. */
    scenarioOneTime?: number;
  },
): ExpenseYear {
  const year = startYear + yearIndex;
  const infl = inflationFactor(cfg, yearIndex);
  const items: { label: string; amount: number }[] = [];
  const discretionaryCut = (cfg.postExitDiscretionaryCutPct ?? 0) / 100;

  let base = 0;

  if (cfg.expenseCategories && cfg.expenseCategories.length > 0) {
    for (const c of cfg.expenseCategories) {
      const rate = c.inflationPct ?? cfg.inflationAssumptionPct;
      const catInfl = Math.pow(1 + rate / 100, yearIndex);
      const col = applyColSensitivity(
        opts.expenseMultiplier,
        c.colSensitivity ?? 1,
      );
      let amount = c.annualAmount * catInfl * col;
      if (opts.wageIncomeEnded && !c.essential) {
        amount *= 1 - discretionaryCut;
      }
      base += amount;
      items.push({ label: c.label, amount });
    }
  } else {
    base = cfg.baseAnnualExpenses * infl * opts.expenseMultiplier;
    items.push({ label: "Base living expenses", amount: base });
  }

  // Once income stops, the portfolio has to fund at least the retirement
  // target. This is the "liability" the ALM framing is actually about. The
  // top-up is shown as its own line so the ledger stays additive.
  if (opts.wageIncomeEnded && cfg.retirementIncomeTargetAnnual !== undefined) {
    const floor =
      cfg.retirementIncomeTargetAnnual * infl * opts.expenseMultiplier;
    if (floor > base) {
      items.push({
        label: "Retirement target top-up",
        amount: floor - base,
      });
      base = floor;
    }
  }

  let recurring = 0;
  for (const r of cfg.recurringLiabilities ?? []) {
    if (year < r.startYear) continue;
    if (r.endYear !== undefined && year > r.endYear) continue;
    const amount =
      (r.inflationAdjusted === false ? r.annualAmount : r.annualAmount * infl) *
      opts.expenseMultiplier;
    recurring += amount;
    items.push({ label: r.label, amount });
  }

  let oneTime = 0;
  for (const o of cfg.oneTimeLiabilities ?? []) {
    if (o.year !== year) continue;
    // One-time amounts are entered in today's dollars and inflated to the
    // year they land in — a 2045 wedding does not cost 2026 prices.
    const amount = o.amount * infl * opts.expenseMultiplier;
    oneTime += amount;
    items.push({ label: o.label, amount });
  }

  if (opts.scenarioOneTime) {
    oneTime += opts.scenarioOneTime;
    items.push({
      label: "Scenario expense shock",
      amount: opts.scenarioOneTime,
    });
  }

  return { base, recurring, oneTime, total: base + recurring + oneTime, items };
}
