/**
 * The core cash-flow engine. One loop, shared by every feature in the app.
 *
 * Each simulated year:
 *
 *   income[y]       = f(income config, trajectory, retirement age, relocation)
 *   expenses[y]     = f(expense categories, scenario events, relocation)
 *   deferral[y]     = pre-tax contribution to the tax-advantaged account
 *   taxes[y]        = f(active jurisdiction, ordinary income - deferral, gains)
 *   freeCashFlow[y] = income - expenses - taxes
 *
 *   leftover >= 0 -> contribute (split across account types)
 *   leftover <  0 -> withdraw, in order: cash buffer, taxable, tax-advantaged
 *
 * Things this does that generic calculators usually don't:
 *
 * 1. Taxable and tax-advantaged balances are tracked SEPARATELY, with real
 *    cost-basis accounting on the taxable side. A withdrawal realizes only the
 *    gain portion; a tax-advantaged withdrawal is ordinary income instead.
 *
 * 2. A traditional 401k/IRA contribution is deducted from ordinary income in
 *    the year it is made, and taxed on withdrawal. Payroll tax is deliberately
 *    NOT reduced — FICA applies to elective deferrals.
 *
 * 3. The tax bill and the withdrawal are solved jointly. Withdrawing to cover a
 *    shortfall creates taxable income, which increases the shortfall, which
 *    requires a larger withdrawal. We iterate to a fixed point rather than
 *    pretending the withdrawal is tax-free.
 *
 * 4. When a year cannot be funded, the deferral is cut back BEFORE anything is
 *    sold — which is what people actually do.
 *
 * 5. A government benefit (Social Security, or CPP + OAS) is solved inside the
 *    same fixed point, because how much of it is taxable depends on the rest of
 *    the year's income — including the very withdrawal it is helping to avoid.
 *
 * Modelling assumptions worth knowing:
 *  - The portfolio is rebalanced to the target allocation annually, which is
 *    what applying a single blended return to the whole balance implies.
 *  - Returns are applied to the opening balance; contributions and withdrawals
 *    land at year end. This slightly understates growth on new contributions.
 *  - No RMDs, no early-withdrawal penalties, no employer match.
 */

import { blendedReturn, generateReturnPath, normalizeAllocation } from "./market";
import { baseSpend, expensesForYear, inflationFactor } from "./liabilities";
import { ageInYear, incomeForYear } from "./income";
import { buildRegimeTimeline } from "./relocation";
import { resolveScenario } from "./scenario";
import { computeTax } from "./tax";
import { benefitForYear, BenefitYear } from "./benefits";
import { PathResult, SimulationConfig, YearResult } from "./types";

const SOLVE_TOLERANCE = 1;
const SOLVE_MAX_ITERATIONS = 25;

/** 2025 elective deferral limit, indexed forward like the bracket tables. */
const DEFAULT_DEFERRAL_LIMIT = 23_500;

export function runPath(config: SimulationConfig): PathResult {
  const {
    income,
    assets,
    liabilities,
    scenario,
    horizonYears,
    startJurisdiction,
  } = config;

  const startYear = income.startYear;
  const allocation = normalizeAllocation(assets.allocation);
  const returns = generateReturnPath({
    horizonYears,
    startYear,
    scenario,
    deterministic: config.deterministic,
    medianAdjustAllocation: config.medianAdjusted ? allocation : undefined,
    seed: config.seed ?? 1,
  });
  const regimes = buildRegimeTimeline(
    startJurisdiction,
    startYear,
    horizonYears,
    scenario.relocationEvents,
  );
  const resolved = resolveScenario(
    scenario,
    startYear,
    horizonYears,
    // Use the planned spend — the sum of the categories when they are set —
    // so a preset's expense shock scales to the real budget.
    baseSpend(liabilities),
  );

  const splitTotal =
    assets.accountSplit.taxAdvantaged + assets.accountSplit.taxable;
  const taxableShare =
    splitTotal > 0 ? assets.accountSplit.taxable / splitTotal : 0;

  let taxableBalance = assets.currentBalance * taxableShare;
  let taxableBasis = taxableBalance * assets.costBasisFraction;
  let taxAdvantagedBalance = assets.currentBalance * (1 - taxableShare);
  let cashBuffer = assets.startingCashBuffer ?? 0;

  const contributionRate = assets.contributionRatePct / 100;
  const taxAdvContribShare =
    (assets.taxAdvantagedContributionSharePct ?? 0) / 100;
  const preTax = assets.taxAdvantagedContributionsArePreTax !== false;

  const years: YearResult[] = [];
  let peakNetWorth = taxableBalance + taxAdvantagedBalance + cashBuffer;
  let maxDrawdownPct = 0;
  let firstShortfallYearIndex: number | null = null;
  let totalShortfall = 0;
  let wageEndedSticky = false;

  let totalContributions = 0;
  let totalWithdrawals = 0;
  let totalInvestmentGain = 0;
  let totalTaxPaid = 0;
  let totalRealizedGains = 0;
  let totalCapitalGainsTax = 0;
  let totalBenefitsReceived = 0;
  let cumulativeGrowth = 1;

  const filingStatus = income.filingStatus;

  for (let y = 0; y < horizonYears; y++) {
    const year = startYear + y;
    const regime = regimes[y];
    const infl = inflationFactor(liabilities, y);
    const ctx = { filingStatus, inflationFactor: infl };

    // --- Market leg: opening balances grow before any flow. ----------------
    const r = blendedReturn(allocation, returns[y]);
    const cashReturn = returns[y].cash;

    const openingTaxable = taxableBalance;
    const openingPortfolio = taxableBalance + taxAdvantagedBalance;
    const investmentGain = openingPortfolio * r + cashBuffer * cashReturn;

    taxableBalance = taxableBalance * (1 + r);
    taxAdvantagedBalance = taxAdvantagedBalance * (1 + r);
    cashBuffer = cashBuffer * (1 + cashReturn);
    // Growth is unrealized: basis does not move. It is capped at the balance
    // so a drawdown below basis cannot produce a negative gain fraction.
    if (openingTaxable > 0) taxableBasis = Math.min(taxableBasis, taxableBalance);

    // --- Income leg --------------------------------------------------------
    const inc = incomeForYear(income, y, infl);
    const incomeMult =
      regime.incomeMultiplier * resolved.incomeMultiplierByYearIndex[y];
    const wage = inc.wage * incomeMult;
    const other = inc.other;
    const totalWageAndOther = wage + other;
    const age = ageInYear(income, y);

    if (inc.wageIncomeEnded) wageEndedSticky = true;

    // --- Liability leg -----------------------------------------------------
    const exp = expensesForYear(liabilities, y, startYear, {
      expenseMultiplier: regime.expenseMultiplier,
      wageIncomeEnded: wageEndedSticky,
      scenarioOneTime: resolved.extraExpenseByYearIndex[y],
    });

    // --- Joint solve: deferral, benefit, tax and withdrawal ----------------
    // Every one of these depends on the others. The benefit's taxable portion
    // depends on other income; other income depends on the withdrawal; the
    // withdrawal depends on the tax bill; the tax bill depends on the benefit.
    // One helper evaluates a candidate state so both loops below agree.
    const targetSavings = Math.max(0, totalWageAndOther * contributionRate);
    const deferralLimit =
      (assets.annualTaxAdvantagedLimit ?? DEFAULT_DEFERRAL_LIMIT) * infl;

    const evaluate = (
      deferral: number,
      taxAdvW: number,
      realized: number,
    ): {
      benefit: BenefitYear;
      cashIncome: number;
      ordinary: number;
      bill: ReturnType<typeof computeTax>;
      leftover: number;
    } => {
      const deduction = preTax ? deferral : 0;
      // The benefit's own taxability test sees everything else recognized.
      const otherRecognized =
        totalWageAndOther - deduction + taxAdvW + realized;
      const benefit = benefitForYear(
        income.retirementBenefit,
        age,
        infl,
        otherRecognized,
        filingStatus,
      );
      const cashIncome = totalWageAndOther + benefit.net;
      const ordinary =
        totalWageAndOther - deduction + benefit.taxable + taxAdvW;
      const bill = computeTax({
        jurisdiction: regime.jurisdiction,
        wages: wage,
        ordinaryIncome: ordinary,
        stateExemptOrdinaryIncome: benefit.stateExempt,
        realizedGains: realized,
        ctx,
      });
      return {
        benefit,
        cashIncome,
        ordinary,
        bill,
        leftover: cashIncome - deferral - bill.total - exp.total,
      };
    };

    let taxAdvContribution = Math.min(
      targetSavings * taxAdvContribShare,
      deferralLimit,
      Math.max(0, wage),
    );

    let state = evaluate(taxAdvContribution, 0, 0);

    // A pre-tax deferral lowers taxable income, which lowers tax, which raises
    // the cash left over. If the year still cannot be funded, the deferral is
    // cut back before anything is sold.
    for (let iter = 0; iter < SOLVE_MAX_ITERATIONS && state.leftover < 0; iter++) {
      if (taxAdvContribution <= 0) break;
      taxAdvContribution = Math.max(0, taxAdvContribution + state.leftover);
      state = evaluate(taxAdvContribution, 0, 0);
    }
    if (state.leftover < 0 && taxAdvContribution > 0) {
      // Ran out of iterations: no deferral at all rather than an inconsistent one.
      taxAdvContribution = 0;
      state = evaluate(0, 0, 0);
    }

    // --- Withdrawal solve --------------------------------------------------
    const gainFraction =
      taxableBalance > 0 ? Math.max(0, 1 - taxableBasis / taxableBalance) : 0;

    let fromCash = 0;
    let fromTaxable = 0;
    let taxAdvWithdrawal = 0;
    let realizedGains = 0;
    let shortfallAmount = 0;

    if (state.leftover < 0) {
      let previousGross = 0;
      for (let iter = 0; iter < SOLVE_MAX_ITERATIONS; iter++) {
        state = evaluate(taxAdvContribution, taxAdvWithdrawal, realizedGains);
        if (state.leftover >= 0) {
          fromCash = 0;
          fromTaxable = 0;
          taxAdvWithdrawal = 0;
          realizedGains = 0;
          shortfallAmount = 0;
          break;
        }

        let need = -state.leftover;
        fromCash = Math.min(cashBuffer, need);
        need -= fromCash;
        fromTaxable = Math.min(taxableBalance, need);
        need -= fromTaxable;
        taxAdvWithdrawal = Math.min(taxAdvantagedBalance, need);
        need -= taxAdvWithdrawal;
        shortfallAmount = need;
        realizedGains = fromTaxable * gainFraction;

        const gross = fromCash + fromTaxable + taxAdvWithdrawal;
        if (Math.abs(gross - previousGross) < SOLVE_TOLERANCE) break;
        previousGross = gross;
      }
    }

    const benefit = state.benefit;
    const bill = state.bill;
    const totalIncome = state.cashIncome;
    const ordinaryTaxableIncome = state.ordinary;
    const leftover = state.leftover;

    const freeCashFlow = totalIncome - exp.total - bill.total;

    // --- Apply flows -------------------------------------------------------
    const withdrawal = fromCash + fromTaxable + taxAdvWithdrawal;
    let taxableContribution = 0;

    if (withdrawal === 0) {
      taxableContribution = Math.min(
        Math.max(0, leftover),
        Math.max(0, targetSavings - taxAdvContribution),
      );
      cashBuffer += Math.max(0, leftover) - taxableContribution;

      taxAdvantagedBalance += taxAdvContribution;
      taxableBalance += taxableContribution;
      // New taxable dollars are contributed at cost, so basis rises 1:1.
      taxableBasis += taxableContribution;
    } else {
      // A year that had to sell does not also contribute.
      taxAdvContribution = 0;
      cashBuffer -= fromCash;
      if (fromTaxable > 0) {
        const basisConsumed =
          taxableBalance > 0 ? fromTaxable * (taxableBasis / taxableBalance) : 0;
        taxableBalance -= fromTaxable;
        taxableBasis = Math.max(0, taxableBasis - basisConsumed);
      }
      taxAdvantagedBalance -= taxAdvWithdrawal;
    }

    const contribution = taxAdvContribution + taxableContribution;

    taxableBalance = Math.max(0, taxableBalance);
    taxAdvantagedBalance = Math.max(0, taxAdvantagedBalance);
    cashBuffer = Math.max(0, cashBuffer);

    const portfolioBalance = taxableBalance + taxAdvantagedBalance;
    const netWorth = portfolioBalance + cashBuffer;

    if (netWorth > peakNetWorth) peakNetWorth = netWorth;
    if (peakNetWorth > 0) {
      const dd = (peakNetWorth - netWorth) / peakNetWorth;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }

    if (shortfallAmount > 0) {
      totalShortfall += shortfallAmount;
      if (firstShortfallYearIndex === null) firstShortfallYearIndex = y;
    }

    totalContributions += contribution;
    totalWithdrawals += withdrawal;
    totalInvestmentGain += investmentGain;
    totalTaxPaid += bill.total;
    totalRealizedGains += realizedGains;
    totalCapitalGainsTax += bill.capitalGainsTax;
    totalBenefitsReceived += benefit.net;
    cumulativeGrowth *= 1 + r;

    years.push({
      year,
      yearIndex: y,
      age,
      jurisdiction: regime.jurisdiction,
      grossWageIncome: wage,
      otherIncome: other,
      benefitGross: benefit.gross,
      benefitClawback: benefit.clawback,
      benefitNet: benefit.net,
      benefitTaxable: benefit.taxable,
      totalIncome,
      expenses: exp.total,
      expenseBreakdown: exp.items,
      totalTax: bill.total,
      incomeTax: bill.incomeTax,
      payrollTax: bill.payrollTax,
      capitalGainsTax: bill.capitalGainsTax,
      ordinaryTaxableIncome,
      freeCashFlow,
      contribution,
      taxAdvantagedContribution: taxAdvContribution,
      taxableContribution,
      withdrawal,
      realizedGains,
      taxAdvantagedWithdrawal: taxAdvWithdrawal,
      blendedReturnPct: r * 100,
      investmentGain,
      cashBuffer,
      taxableBalance,
      taxableBasis,
      unrealizedGain: Math.max(0, taxableBalance - taxableBasis),
      taxAdvantagedBalance,
      portfolioBalance,
      netWorth,
      shortfall: shortfallAmount > 0,
      shortfallAmount,
    });
  }

  const n = years.length || 1;

  return {
    years,
    terminalNetWorth: years.length ? years[years.length - 1].netWorth : 0,
    maxDrawdownPct: maxDrawdownPct * 100,
    firstShortfallYearIndex,
    totalShortfall,
    totalContributions,
    totalWithdrawals,
    totalInvestmentGain,
    totalTaxPaid,
    totalRealizedGains,
    totalCapitalGainsTax,
    totalBenefitsReceived,
    // Time-weighted: the portfolio's own return, independent of when money
    // went in. That is what "what did my portfolio return" means.
    annualizedReturnPct: (Math.pow(cumulativeGrowth, 1 / n) - 1) * 100,
  };
}
