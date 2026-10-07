/**
 * Regime-switch logic for jurisdiction changes mid-simulation.
 *
 * A relocation changes three things at once and they must move together:
 * the active tax module, the cost-of-living multiplier on expenses, and
 * (optionally) a pay adjustment. Multipliers compound across successive moves
 * so a NYC -> Seattle -> LA path lands where you'd expect.
 */

import { Jurisdiction, RelocationEvent } from "./types";

export interface RegimeYear {
  jurisdiction: Jurisdiction;
  expenseMultiplier: number;
  incomeMultiplier: number;
}

export function buildRegimeTimeline(
  startJurisdiction: Jurisdiction,
  startYear: number,
  horizonYears: number,
  events: RelocationEvent[] = [],
): RegimeYear[] {
  const sorted = [...events].sort((a, b) => a.year - b.year);
  const timeline: RegimeYear[] = [];

  let jurisdiction = startJurisdiction;
  let expenseMultiplier = 1;
  let incomeMultiplier = 1;
  let next = 0;

  for (let y = 0; y < horizonYears; y++) {
    const year = startYear + y;
    while (next < sorted.length && sorted[next].year <= year) {
      const e = sorted[next];
      jurisdiction = e.toJurisdiction;
      expenseMultiplier *= e.expenseLevelMultiplier ?? 1;
      incomeMultiplier *= e.incomeMultiplier ?? 1;
      next++;
    }
    timeline.push({ jurisdiction, expenseMultiplier, incomeMultiplier });
  }

  return timeline;
}

/** Rough relative cost-of-living levels, for prefilling the UI. */
export const COST_OF_LIVING_INDEX: Record<Jurisdiction, number> = {
  nyc: 1.0,
  jerseycity: 0.85,
  la: 0.88,
  seattle: 0.8,
};

/** Suggested expense multiplier for a move between two jurisdictions. */
export function suggestedExpenseMultiplier(
  from: Jurisdiction,
  to: Jurisdiction,
): number {
  return COST_OF_LIVING_INDEX[to] / COST_OF_LIVING_INDEX[from];
}
