/**
 * Scenario resolution.
 *
 * The important behaviour here: a `correlatedStressPreset` bundles the market
 * leg and the income/expense leg into one event so they land in the same year
 * by construction. Selecting "pessimistic market" and "layoff in year 5"
 * independently understates real risk, because in reality those two are the
 * same event. `scenarioWarnings` surfaces that when the user does it anyway.
 */

import { ScenarioConfig } from "./types";

export interface ResolvedScenario extends ScenarioConfig {
  /** Multiplier applied to wage income, by year index. */
  incomeMultiplierByYearIndex: number[];
  /** Extra one-time expense, by year index. */
  extraExpenseByYearIndex: number[];
}

const PRESET_DEFAULT_SHOCK_PCT = -30;

export function resolveScenario(
  scenario: ScenarioConfig,
  startYear: number,
  horizonYears: number,
  baseAnnualExpenses: number,
): ResolvedScenario {
  const incomeMult = new Array(horizonYears).fill(1);
  const extraExpense = new Array(horizonYears).fill(0);

  const out: ResolvedScenario = {
    ...scenario,
    incomeMultiplierByYearIndex: incomeMult,
    extraExpenseByYearIndex: extraExpense,
  };

  const eventYearIndex =
    scenario.shockYear !== undefined ? scenario.shockYear - startYear : -1;

  if (scenario.correlatedStressPreset) {
    // The preset owns the market leg too, so the drawdown and the personal
    // event cannot be separated by the user.
    if (scenario.shockYear === undefined) {
      throw new Error(
        "correlatedStressPreset requires shockYear — the preset ties the market leg and the personal leg to the same year.",
      );
    }
    if (out.shockMagnitudePct === undefined) {
      out.shockMagnitudePct = PRESET_DEFAULT_SHOCK_PCT;
    }

    if (scenario.correlatedStressPreset === "recession_plus_layoff") {
      // 18 months out of work, then a return at 90% of prior pay.
      if (eventYearIndex >= 0 && eventYearIndex < horizonYears) {
        incomeMult[eventYearIndex] = 0.15;
      }
      if (eventYearIndex + 1 >= 0 && eventYearIndex + 1 < horizonYears) {
        incomeMult[eventYearIndex + 1] = 0.6;
      }
      for (let y = eventYearIndex + 2; y < horizonYears; y++) {
        if (y >= 0) incomeMult[y] = 0.9;
      }
    }

    if (scenario.correlatedStressPreset === "recession_plus_expense_shock") {
      // A forced, unavoidable outlay landing in the same year as the drawdown.
      if (eventYearIndex >= 0 && eventYearIndex < horizonYears) {
        extraExpense[eventYearIndex] = baseAnnualExpenses * 0.75;
      }
      if (eventYearIndex + 1 >= 0 && eventYearIndex + 1 < horizonYears) {
        extraExpense[eventYearIndex + 1] = baseAnnualExpenses * 0.25;
      }
    }
  }

  if (scenario.manualIncomeShock) {
    const idx = scenario.manualIncomeShock.year - startYear;
    for (let k = 0; k < scenario.manualIncomeShock.years; k++) {
      const y = idx + k;
      if (y >= 0 && y < horizonYears) {
        incomeMult[y] *= scenario.manualIncomeShock.incomeMultiplier;
      }
    }
  }

  if (scenario.manualExpenseShock) {
    const idx = scenario.manualExpenseShock.year - startYear;
    if (idx >= 0 && idx < horizonYears) {
      extraExpense[idx] += scenario.manualExpenseShock.amount;
    }
  }

  return out;
}

/**
 * Flags scenario setups that understate risk. Surface these in the UI rather
 * than silently correcting them — the user may know exactly what they want.
 */
export function scenarioWarnings(scenario: ScenarioConfig): string[] {
  const warnings: string[] = [];

  const hasManualPersonalShock =
    !!scenario.manualIncomeShock || !!scenario.manualExpenseShock;

  if (!scenario.correlatedStressPreset && hasManualPersonalShock) {
    const shockYears = [
      scenario.manualIncomeShock?.year,
      scenario.manualExpenseShock?.year,
    ].filter((y): y is number => y !== undefined);
    const marketShockYear = scenario.shockYear;
    const aligned =
      marketShockYear !== undefined &&
      shockYears.some((y) => Math.abs(y - marketShockYear) <= 1);

    if (!aligned) {
      warnings.push(
        "You have set a personal income or expense shock independently of the market path. " +
          "In practice layoffs and forced expenses cluster with drawdowns; treating them as " +
          "independent understates joint risk. Consider a correlated stress preset.",
      );
    }
  }

  if (
    scenario.marketPath === "pessimistic" &&
    !scenario.correlatedStressPreset &&
    !hasManualPersonalShock
  ) {
    warnings.push(
      "A pessimistic market path with no income or expense event models a bad market " +
        "for someone whose job and spending are unaffected by it. That is an optimistic " +
        "reading of a recession.",
    );
  }

  return warnings;
}
