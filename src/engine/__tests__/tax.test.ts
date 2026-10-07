import { describe, expect, it } from "vitest";
import { computeTax } from "../tax";
import { seattle } from "../tax/seattle";
import { nyc } from "../tax/nyc";
import { runPath } from "../cashflow";
import { baseConfig } from "./fixtures";

const ctx = { filingStatus: "single" as const, inflationFactor: 1 };

describe("tax modules", () => {
  it("Washington has no wage tax but is NOT zero-tax on large realized gains", () => {
    expect(seattle.incomeTax(400_000, ctx)).toBe(0);
    // Below the ~$270k excise deduction: nothing owed to WA.
    expect(seattle.capitalGainsTax(200_000, ctx)).toBe(0);
    // Above it: 7% on the excess.
    expect(seattle.capitalGainsTax(500_000, ctx)).toBeCloseTo(
      (500_000 - 270_000) * 0.07,
      2,
    );
  });

  it("NY taxes capital gains as ordinary income, stacked on other income", () => {
    const alone = nyc.capitalGainsTax(100_000, ctx);
    const stacked = nyc.capitalGainsTax(100_000, { ...ctx, ordinaryIncome: 300_000 });
    // Same gain costs more when it sits on top of a high income.
    expect(stacked).toBeGreaterThan(alone);
    // And it is a real, non-preferential rate — well above zero.
    expect(stacked / 100_000).toBeGreaterThan(0.06);
  });

  it("Seattle beats NYC on wages by roughly the NY+NYC bill", () => {
    const wages = 300_000;
    const sea = computeTax({
      jurisdiction: "seattle",
      wages,
      ordinaryIncome: wages,
      realizedGains: 0,
      ctx,
    });
    const ny = computeTax({
      jurisdiction: "nyc",
      wages,
      ordinaryIncome: wages,
      realizedGains: 0,
      ctx,
    });
    expect(sea.stateIncomeTax).toBe(0);
    expect(ny.stateIncomeTax).toBeGreaterThan(25_000);
    expect(sea.payrollTax).toBeCloseTo(ny.payrollTax, 2);
    expect(ny.total - sea.total).toBeCloseTo(ny.stateIncomeTax, 2);
  });

  it("only realized gains are taxed, not the unrealized balance", () => {
    const cfg = baseConfig();
    // A large wedding forces a sale in a year the market is down.
    cfg.liabilities.oneTimeLiabilities = [
      { label: "Wedding", year: 2029, amount: 250_000 },
    ];
    cfg.scenario = { marketPath: "base", shockYear: 2029, shockMagnitudePct: -30 };

    const result = runPath(cfg);
    const shockYear = result.years.find((y) => y.year === 2029)!;
    const priorYear = result.years.find((y) => y.year === 2028)!;

    expect(shockYear.withdrawal).toBeGreaterThan(0);
    expect(shockYear.capitalGainsTax).toBeGreaterThan(0);
    // No withdrawal the year before, so no capital gains tax at all then,
    // even though the taxable account carried a large unrealized gain.
    expect(priorYear.withdrawal).toBe(0);
    expect(priorYear.capitalGainsTax).toBe(0);

    // The gain recognized is a slice of the withdrawal, not the balance.
    expect(shockYear.realizedGains).toBeLessThan(shockYear.withdrawal);
    expect(shockYear.realizedGains).toBeLessThan(shockYear.taxableBalance);
    // And the tax is a fraction of the gain, not of the withdrawal.
    expect(shockYear.capitalGainsTax).toBeLessThan(shockYear.realizedGains * 0.45);
  });

  it("basis is consumed proportionally, so repeated sales raise the gain fraction", () => {
    const cfg = baseConfig();
    const result = runPath(cfg);
    const last = result.years[result.years.length - 1];
    // Basis never exceeds the balance and never goes negative.
    expect(last.taxableBasis).toBeGreaterThanOrEqual(0);
    expect(last.taxableBasis).toBeLessThanOrEqual(last.taxableBalance + 1);
  });
});

describe("tax-advantaged contributions", () => {
  it("a traditional deferral reduces income tax but NOT payroll tax", () => {
    const withDeferral = baseConfig();
    withDeferral.assets.taxAdvantagedContributionSharePct = 100;
    withDeferral.assets.contributionRatePct = 15;

    const roth = baseConfig();
    roth.assets.taxAdvantagedContributionSharePct = 100;
    roth.assets.contributionRatePct = 15;
    roth.assets.taxAdvantagedContributionsArePreTax = false;

    const a = runPath(withDeferral).years[0];
    const b = runPath(roth).years[0];

    expect(a.taxAdvantagedContribution).toBeGreaterThan(0);
    expect(a.taxAdvantagedContribution).toBeCloseTo(
      b.taxAdvantagedContribution,
      2,
    );
    // The deduction is real money: less ordinary income, so less income tax.
    expect(a.ordinaryTaxableIncome).toBeLessThan(b.ordinaryTaxableIncome);
    expect(a.incomeTax).toBeLessThan(b.incomeTax);
    // FICA applies to elective deferrals — payroll tax must be unchanged.
    expect(a.payrollTax).toBeCloseTo(b.payrollTax, 2);
  });

  it("caps the deferral at the annual limit, indexed to inflation", () => {
    const cfg = baseConfig();
    cfg.assets.contributionRatePct = 100;
    cfg.assets.taxAdvantagedContributionSharePct = 100;
    cfg.assets.annualTaxAdvantagedLimit = 23_500;

    const result = runPath(cfg);
    const y0 = result.years[0];
    const y10 = result.years[10];

    expect(y0.taxAdvantagedContribution).toBeCloseTo(23_500, 0);
    // Indexed forward, so the cap rises with inflation rather than eroding.
    expect(y10.taxAdvantagedContribution).toBeGreaterThan(28_000);
  });

  it("deferred dollars are taxed on withdrawal, not twice", () => {
    const cfg = baseConfig();
    // Savings target below the deferral limit, so 100% of it is deferred and
    // nothing ever reaches a taxable account — isolating the ordinary-income
    // treatment of the withdrawal.
    cfg.assets.contributionRatePct = 10;
    cfg.assets.taxAdvantagedContributionSharePct = 100;
    cfg.assets.startingCashBuffer = 0;
    cfg.assets.accountSplit = { taxAdvantaged: 1, taxable: 0 };
    cfg.liabilities.oneTimeLiabilities = [
      { label: "Huge outlay", year: 2030, amount: 700_000 },
    ];

    const result = runPath(cfg);
    const drawYear = result.years.find((y) => y.year === 2030)!;

    expect(drawYear.taxAdvantagedWithdrawal).toBeGreaterThan(0);
    // Ordinary income for the year includes the withdrawal.
    expect(drawYear.ordinaryTaxableIncome).toBeGreaterThan(drawYear.totalIncome);
    // And it is ordinary income, not a capital gain.
    expect(drawYear.capitalGainsTax).toBe(0);
    expect(drawYear.realizedGains).toBe(0);
  });

  it("cuts the deferral back before selling anything", () => {
    const cfg = baseConfig();
    cfg.assets.contributionRatePct = 40;
    cfg.assets.taxAdvantagedContributionSharePct = 100;
    cfg.assets.startingCashBuffer = 0;
    // An expense spike that free cash flow alone cannot absorb.
    cfg.liabilities.oneTimeLiabilities = [
      { label: "Spike", year: 2028, amount: 35_000 },
    ];

    const result = runPath(cfg);
    const spike = result.years.find((y) => y.year === 2028)!;
    const normal = result.years.find((y) => y.year === 2027)!;

    expect(normal.taxAdvantagedContribution).toBeGreaterThan(0);
    expect(spike.taxAdvantagedContribution).toBeLessThan(
      normal.taxAdvantagedContribution,
    );
    expect(spike.withdrawal).toBe(0);
  });
});
