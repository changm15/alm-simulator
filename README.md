# Personal ALM Simulator

A personal cash-flow simulator built on asset-liability management principles:
one shared engine resolves income, liabilities, taxes, and market returns
together each year, then measures how sensitive the outcome is to **asset
allocation** specifically.

It is a planning and education tool. It shows how allocations behave under
stated assumptions; it does not produce a recommendation and is not investment,
tax, or legal advice.

```bash
npm install
npm test                        # 24 engine tests, no UI required
npm run dev -- --host           # http://localhost:5178 + a LAN URL for your phone
npm run build && npm run preview -- --host   # production build instead
```

The UI is responsive down to phone widths: the four config blocks stack, inputs
are 16px so iOS does not zoom on focus, charts size their viewBox to the real
container width (so axis text stays 10px rather than shrinking with the page),
sweep facets stack vertically, and the ledger drops to its key columns behind a
"show all columns" toggle. There is a web app manifest, so it can be added to a
phone home screen and opened standalone.

## Architecture

```
src/engine/
  types.ts        the four independent config blocks + result shapes
  rng.ts          seeded RNG, Box-Muller normals, Cholesky, percentiles
  market.ts       capital market assumptions, correlated return paths, shock injector
  income.ts       trajectories, explicit salary schedules, retirement-by-age
  liabilities.ts  category-based spending plan, one-time events, funding floor
  relocation.ts   jurisdiction regime timeline, compounding COL/pay multipliers
  scenario.ts     correlated stress presets + risk-understatement warnings
  tax/            federal.ts + seattle | nyc | jerseycity | la
  cashflow.ts     THE loop — one year at a time, shared by everything
  simulate.ts     Monte Carlo wrapper, percentile bands, shortfall probability
  sensitivity.ts  the allocation sweep
src/ui/           React UI; the engine never imports from here
  App.tsx         app shell: top bar, nav rail, view routing, the two clocks
  controls.tsx    the control atoms (adorned inputs, segments, sliders, disclosure)
  sections.tsx    the four config sections
  OutcomeRail.tsx the live outcome panel
  share.ts        whole config <-> URL hash, plus localStorage autosave
```

`cashflow.ts` is the only place a year is advanced. Every other module either
feeds it or aggregates over it.

## What the engine does that generic calculators usually don't

**Salary can be an explicit schedule.** Beyond the modelled trajectories
(promotion track / flat / early exit) you can type a salary per calendar year.
Those figures are treated as NOMINAL — exactly what you expect to be paid that
year, with no inflation layered on top, because a number you typed for 2031 is
the number you mean. Years you skip hold the previous figure rather than being
interpolated: if you did not state it, the model does not invent it. Past the
last entry, salary compounds at a stated nominal growth rate. Retirement age,
relocation pay multipliers, and scenario income shocks all still apply on top.

**Traditional 401k/IRA contributions are pre-tax.** The deferral is deducted
from ordinary income in the year it is made and taxed on withdrawal — never
both. Payroll tax is deliberately *not* reduced, because FICA applies to
elective deferrals. The deferral is capped at an inflation-indexed annual limit,
and when a year cannot be funded it is cut back *before* anything is sold, which
is what people actually do. Flip the account type to Roth to model the reverse.

**Spending is planned as categories, not one number.** Each category carries its
own inflation rate (healthcare and childcare run well above headline CPI), its
own cost-of-living sensitivity (a move cuts rent a lot and streaming
subscriptions not at all), and an essential flag that decides whether it
survives a post-retirement cut.

**Separate account tracks with real basis accounting.** Taxable and
tax-advantaged balances never blend. A taxable withdrawal realizes only the
gain portion, with basis consumed proportionally; contributions add basis 1:1.
A tax-advantaged withdrawal is ordinary income instead. `costBasisFraction`
seeds the *starting* basis only — after that the engine tracks it.

**Joint tax/withdrawal solve.** Covering a shortfall creates taxable income,
which enlarges the shortfall, which requires a larger withdrawal. The engine
iterates to a fixed point rather than pretending the withdrawal is tax-free.

**Correlated returns.** Asset-class draws go through a Cholesky factor of a real
correlation matrix. With independent draws the model would wildly overstate
diversification and the whole allocation sweep would be meaningless.

**Treasuries rally into a shock.** Each asset class has a `shockBeta`;
Treasuries' is negative (flight to quality). That is the mechanism that makes a
Treasury sleeve genuinely insulating rather than merely lower-return.

**Brackets are indexed to inflation.** Without it, a 35-year run pushes everyone
into the top bracket through pure bracket creep — a modelling artifact, not an
outcome.

**Correlated stress is bundled.** `correlatedStressPreset` ties the market leg
and the layoff/expense leg to the same year by construction. If you set them
independently anyway, `scenarioWarnings()` says so rather than silently letting
the model understate joint risk.

## Deviations from the original spec, and why

1. **Sequence-of-returns risk flips sign between accumulation and
   decumulation.** The spec expected an early shock to beat a late one
   generally. That is true when you are *withdrawing* — selling into a
   drawdown permanently removes shares. In pure accumulation the opposite
   holds: an early shock hits a small balance and every later contribution
   buys in cheap, while a late shock hits the full balance with no recovery
   time. Both directions are asserted in `market.test.ts`; treat the
   accumulation result as a real finding, not a bug.

2. **No dual-axis chart.** The spec asked for median outcome and
   drawdown/spread on paired y-axes. Two y-scales in one plot make the
   crossing point of the two lines an artifact of the scaling choice, which is
   exactly the comparison the feature exists to support. The sweep is drawn as
   stacked panels sharing the allocation x-axis instead, with a shared y-domain
   across the two scenario columns so they are comparable by eye, plus a table
   view of the same numbers.

3. **Sequence risk is only half the story on the reporting side.** The stat row
   decomposes terminal wealth into what you contributed versus what the market
   added, and reports the effective tax rate against the actual *tax base*
   (ordinary taxable income plus realized gains), not gross wages — dividing
   lifetime tax by wages alone badly overstates the rate in a long plan, because
   retirement withdrawals are taxed but are not wages.

4. **`contributionRatePct` is a target savings rate, with a cash buffer.** The
   spec's core equation (`contribution = income - expenses - taxes`) and a
   separate "% of income auto-saved" field conflict. Resolution: free cash flow
   above the target savings rate accumulates in a side cash buffer, and
   withdrawals draw that buffer down before selling any asset. Set the rate to
   100% to get the spec's literal behaviour.

5. **The existing `city-take-home-comparison.jsx` artifact was not on this
   machine**, so the bracket tables were written from scratch (2025 figures).
   They should be reconciled against that artifact before you trust the
   take-home numbers.

## The UI

An app shell, not a form on a page: a persistent nav rail (Configure / Results),
a scrolling centre, and a right rail carrying the consequence of every edit.
Units live inside controls as adornments rather than in labels, ratios that used
to be bare 0–1 numbers are sliders and three-way segments, and advanced knobs
(cost basis, the deferral limit, post-exit replacement) fold behind disclosures.

**Two clocks drive the outcome rail.** The headline and sparkline come from a
single deterministic run of the real engine — same taxes, same cost-basis
tracking, same forced sales — which costs about **0.5 ms**, so it recomputes on
every keystroke and never lags the controls. The distribution figures come from
the full Monte Carlo at **65 ms** for 500 paths and **123 ms** for 1000; both
are well over one frame, so it runs through `useDeferredValue` and the block
dims while it catches up rather than showing numbers that disagree with the
controls.

That deterministic path is **corrected for volatility drag**. Compounding the
arithmetic mean every year is not the typical outcome — uncorrected it lands
about 8% above the Monte Carlo median over 30 years and roughly 50% above it
over a 63-year plan, which would put a headline number in open contradiction
with the distribution printed underneath it. `portfolioVariance()` computes
wᵀΣw from the real correlation matrix and the run subtracts σ_p²/2, which lands
the path within a few percent of the median. `market.test.ts` pins both the
uncorrected gap and the corrected agreement.

On a phone the rail moves above the content, navigation becomes a five-item
bottom bar, and the four result views collapse behind one Results tab with its
own switcher — five thumb targets is the ceiling for a bottom bar.

## Presets and sharing

The entire configuration round-trips through the URL hash as versioned,
base64url-encoded JSON — so a preset is just a link, with no server involved.
"Copy share link" writes it to the clipboard where the browser allows it, and
always shows it in a selectable field as well, because clipboard access needs a
secure context and `http://<lan-ip>` is not one. Inputs also autosave to
`localStorage`, so a refresh does not lose a half-finished plan; a link in the
URL always wins over the autosave, so a shared plan opens as it was sent.

A share link carries every number in the config. That is the point, but it is
worth knowing before sending one on.

## Tax coverage and its limits

| | Wage income | Capital gains |
|---|---|---|
| **Seattle, WA** | none | **7% state excise above ~$270k** (indexed), +2.9% above $1M; retirement accounts excluded |
| **NYC, NY** | NY state + NYC resident tax | taxed as ordinary income, both levels |
| **Jersey City, NJ** | NJ state only (no local tax) | taxed as ordinary income |
| **Los Angeles, CA** | CA state only, + 1.2% SDI on all wages | taxed as ordinary income, +1% MHSA above $1M |

Federal throughout: ordinary brackets, standard deduction, long-term capital
gains stacked on ordinary taxable income, NIIT, and FICA.

The Washington case is the one most easily got wrong — "no income tax" is not
"no tax". `relocation.test.ts` asserts that a NYC → Seattle move drops ordinary
income tax but does **not** drop capital gains tax to zero once a taxable
drawdown clears the excise threshold.

Not modelled: credits and phase-outs, itemized deductions, AMT, RMDs,
early-withdrawal penalties, employer match, state nonresident-income credits (notably a Jersey City resident working in NYC), NJ and WA payroll
contributions, and any filing status other than single or MFJ. Tables are 2025
approximations — verify against current law before relying on a number.

## Capital market assumptions

Nominal, annual, long-run, base path. Planning inputs, not forecasts — edit
`CAPITAL_MARKET_ASSUMPTIONS` in `src/engine/market.ts`.

| Class | Mean | Vol | Shock beta |
|---|---|---|---|
| US equity | 7.5% | 17% | 1.00 |
| Intl equity | 7.0% | 19% | 1.05 |
| US Treasuries | 3.5% | 6% | −0.15 |
| Corporate bonds | 4.5% | 8% | 0.35 |
| Cash | 2.5% | 1% | 0.00 |

Other modelling choices: annual rebalancing to target, returns applied to
opening balances with flows landing at year end, one-time liabilities entered
in today's dollars and inflated to the year they land.

## Percentile bands

Charts shade the **interquartile range (25th–75th)** by default; the toolbar
switches to 10th–90th or 25th–50th. The engine computes p10/p25/p50/p75/p90 for
every year and every sweep point, so this is purely a display choice.

Which band you pick changes what the sweep appears to say, and it is worth
knowing why. As the Treasury sleeve grows, the **10th** percentile rises
monotonically — that is tail insurance working. The **25th** does not: it sits
close enough to the median that the median's downward drift overtakes the risk
reduction around 20–30% Treasuries and then falls. So an interquartile band
narrows from *both* sides, while a 10–90 band shows a genuinely rising floor
against a falling ceiling. Neither is wrong; they answer different questions.
`sensitivity.test.ts` pins both behaviours down so a future change to the return
model cannot quietly alter the story.

## The allocation sweep

`runAllocationSweep` re-runs the full Monte Carlo at each Treasury weight,
holding the other sleeves proportional. Every allocation point faces the **same
seeds**, so differences are the allocation rather than noise.

A representative result (35-year accumulation, 300 paths per point):

| Treasuries | Base: median | Base: p10–p90 spread | Stress: median | Stress: p10 |
|---|---|---|---|---|
| 0% | $6.32M | $10.2M | $2.63M | $1.46M |
| 60% | $4.96M | $3.1M | $2.79M | $2.06M |

That is the trade-off, and its scenario-dependence: in the base case Treasuries
cost about 21% of median terminal wealth to cut the outcome spread by 69%. In
the recession-plus-layoff case they cost nothing at the median and raise the
10th percentile by 41%. The tool reports these numbers; drawing a conclusion
from them is your job, not its.
