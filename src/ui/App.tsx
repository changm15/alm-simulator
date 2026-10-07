import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Allocation,
  AssetConfig,
  IncomeConfig,
  Jurisdiction,
  LiabilityConfig,
  ScenarioConfig,
  SimulationConfig,
} from "../engine/types";
import { runPath } from "../engine/cashflow";
import { BandKey, bandFor, runMonteCarlo } from "../engine/simulate";
import { runAllocationSweep, SweepResult } from "../engine/sensitivity";
import { scenarioWarnings } from "../engine/scenario";
import { JURISDICTIONS } from "../engine/tax";
import { DEFAULT_EXPENSE_CATEGORIES, baseSpend } from "../engine/liabilities";
import { Card, Segmented } from "./controls";
import {
  AssetsSection,
  IncomeSection,
  LiabilitiesSection,
  ScenarioSection,
  SectionHead,
} from "./sections";
import { OutcomeRail } from "./OutcomeRail";
import { Chart } from "./charts";
import { Ledger } from "./Ledger";
import { SensitivityPanels } from "./Sensitivity";
import { ExpenseBreakdown } from "./ExpenseBreakdown";
import { CapitalGains } from "./CapitalGains";
import { JURISDICTION_SHORT } from "./labels";
import { useMediaQuery } from "./useMediaQuery";
import { currency } from "./format";
import {
  SHARE_VERSION,
  SharedState,
  clearLocal,
  loadLocal,
  readStateFromUrl,
  saveLocal,
  shareUrlFor,
} from "./share";

const THIS_YEAR = new Date().getFullYear();

const DEFAULT_ALLOCATION: Allocation = {
  usEquity: 0.45,
  intlEquity: 0.15,
  usTreasuries: 0.2,
  corporateBonds: 0.15,
  cash: 0.05,
};

/**
 * The starting plan anyone sees on a fresh visit.
 *
 * Deliberately round, generic figures: this is a public page, and a default
 * state that reads like one person's actual finances is both misleading and
 * nobody else's business. Your own edits live in this browser's localStorage
 * and in share links you choose to send — never in the deployed source.
 */
const DEFAULTS: SharedState = {
  v: SHARE_VERSION,
  income: {
    baseSalary: 100_000,
    startYear: THIS_YEAR,
    currentAge: 28,
    retirementAge: 65,
    trajectory: "promotion_track",
    promotionCapMultiple: 2,
    filingStatus: "single",
    realWageGrowthPct: 0,
    retirementBenefit: {
      system: "us_social_security",
      claimAge: 67,
      monthlyAtFullRetirementAge: 2_000,
      fullRetirementAge: 67,
    },
  },
  assets: {
    currentBalance: 100_000,
    allocation: DEFAULT_ALLOCATION,
    accountSplit: { taxAdvantaged: 0.4, taxable: 0.6 },
    contributionRatePct: 15,
    costBasisFraction: 0.8,
    taxAdvantagedContributionSharePct: 50,
    annualTaxAdvantagedLimit: 23_500,
    taxAdvantagedContributionsArePreTax: true,
    startingCashBuffer: 20_000,
  },
  liabilities: {
    baseAnnualExpenses: 60_000,
    inflationAssumptionPct: 2.5,
    expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
    postExitDiscretionaryCutPct: 20,
    oneTimeLiabilities: [],
    retirementIncomeTargetAnnual: 60_000,
  },
  scenario: { marketPath: "base", relocationEvents: [] },
  startJurisdiction: "nyc",
  planToAge: 90,
  paths: 500,
};

type View =
  | "income"
  | "assets"
  | "liabilities"
  | "scenario"
  | "networth"
  | "spending"
  | "gains"
  | "sensitivity"
  | "ledger";

const ICONS: Record<View, string> = {
  income: "M3 17l6-6 4 4 8-8",
  assets: "M4 7h16M4 12h16M4 17h10",
  liabilities: "M3 10h18M6 10V6h12v4M5 10v10h14V10",
  scenario:
    "M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2",
  networth: "M4 19V5M4 19h16M8 15l4-6 4 3 3-6",
  spending: "M12 3v18M4 8h16M4 16h16",
  gains: "M4 20V4M4 20h16M8 16l3-5 3 3 4-7",
  sensitivity: "M4 20V9M10 20V4M16 20v-7M22 20h-20",
  ledger: "M5 4h14v16H5zM9 8h6M9 12h6M9 16h3",
};

/** URL hash wins over the local autosave, so a shared link opens as sent. */
function initialState(): SharedState {
  return readStateFromUrl() ?? loadLocal() ?? DEFAULTS;
}

export function App() {
  const [seed] = useState(initialState);

  const [income, setIncome] = useState<IncomeConfig>(seed.income);
  const [assets, setAssets] = useState<AssetConfig>(seed.assets);
  const [liabilities, setLiabilities] = useState<LiabilityConfig>(seed.liabilities);
  const [scenario, setScenario] = useState<ScenarioConfig>(seed.scenario);
  const [startJurisdiction, setStartJurisdiction] = useState<Jurisdiction>(
    seed.startJurisdiction,
  );
  const [planToAge, setPlanToAge] = useState(seed.planToAge);
  const [paths, setPaths] = useState(seed.paths);
  const [view, setView] = useState<View>("income");
  const [band, setBand] = useState<BandKey>("p25_p75");

  // A bottom bar tops out at five thumb-sized targets, so on a phone the four
  // result views collapse behind one "Results" tab with its own switcher.
  const compact = useMediaQuery("(max-width: 860px)");

  const shared: SharedState = useMemo(
    () => ({
      v: SHARE_VERSION,
      income,
      assets,
      liabilities,
      scenario,
      startJurisdiction,
      planToAge,
      paths,
    }),
    [income, assets, liabilities, scenario, startJurisdiction, planToAge, paths],
  );

  useEffect(() => {
    saveLocal(shared);
  }, [shared]);

  const horizonYears =
    income.currentAge !== undefined
      ? Math.max(1, planToAge - income.currentAge)
      : 35;

  const config: SimulationConfig = useMemo(
    () => ({
      income,
      assets,
      liabilities,
      scenario,
      horizonYears,
      startJurisdiction,
      seed: 12345,
    }),
    [income, assets, liabilities, scenario, horizonYears, startJurisdiction],
  );

  // Two clocks. The deterministic path is one run of the real engine — cheap
  // enough to recompute on every keystroke, so the rail never lags the controls.
  // medianAdjusted corrects for volatility drag, so this single path lands on
  // the Monte Carlo median rather than well above it. Without it the headline
  // would contradict the distribution printed underneath it.
  const live = useMemo(
    () => runPath({ ...config, deterministic: true, medianAdjusted: true }),
    [config],
  );

  // The Monte Carlo is deferred: dragging a slider must not wait on 500 paths.
  const deferred = useDeferredValue(config);
  const deferredPaths = useDeferredValue(paths);
  const mc = useMemo(
    () => runMonteCarlo(deferred, { paths: deferredPaths }),
    [deferred, deferredPaths],
  );
  const mcStale = deferred !== config || deferredPaths !== paths;

  const warnings = useMemo(() => scenarioWarnings(scenario), [scenario]);
  const [sweeps, setSweeps] = useState<SweepResult[] | null>(null);
  const [sweeping, setSweeping] = useState(false);

  function runSweep() {
    setView("sensitivity");
    setSweeping(true);
    setTimeout(() => {
      const pathsPerPoint = window.innerWidth < 860 ? 150 : 300;
      const stressYear = income.startYear + 5;
      const stress: SimulationConfig = {
        ...config,
        scenario: {
          ...scenario,
          marketPath: "pessimistic",
          shockYear: stressYear,
          shockMagnitudePct: -35,
          correlatedStressPreset: "recession_plus_layoff",
        },
      };
      setSweeps([
        runAllocationSweep(config, "Base case", { pathsPerPoint }),
        runAllocationSweep(stress, `Recession + layoff, ${stressYear}`, {
          pathsPerPoint,
        }),
      ]);
      setSweeping(false);
    }, 20);
  }

  const jurisdictionsUsed = useMemo(() => {
    const set = new Set<Jurisdiction>([startJurisdiction]);
    (scenario.relocationEvents ?? []).forEach((e) => set.add(e.toJurisdiction));
    return [...set];
  }, [startJurisdiction, scenario.relocationEvents]);

  const spend = baseSpend(liabilities);
  const bandSpec = bandFor(band);

  const NAV: { id: View; name: string; sum: string }[] = [
    { id: "income", name: "Income", sum: `${currency(income.baseSalary)} · retire ${income.retirementAge ?? 60}` },
    { id: "assets", name: "Assets", sum: `${currency(assets.currentBalance)} · saving ${assets.contributionRatePct}%` },
    { id: "liabilities", name: "Liabilities", sum: `${currency(spend)}/yr · ${(liabilities.expenseCategories ?? []).length} lines` },
    { id: "scenario", name: "Scenario", sum: `${scenario.marketPath} · ${JURISDICTION_SHORT[startJurisdiction]}` },
  ];
  const RESULT_VIEWS: View[] = [
    "networth",
    "spending",
    "gains",
    "sensitivity",
    "ledger",
  ];
  const RESULTS: { id: View; name: string; sum: string }[] = [
    { id: "networth", name: "Net worth", sum: currency(mc.terminalNetWorth.median) },
    { id: "spending", name: "Spending", sum: `${currency(spend)} a year` },
    {
      id: "gains",
      name: "Capital gains",
      sum: `${currency(mc.representativePath.years[0]?.unrealizedGain ?? 0)} unrealized`,
    },
    { id: "sensitivity", name: "Sensitivity", sum: sweeps ? "run" : "not run" },
    { id: "ledger", name: "Ledger", sum: `${horizonYears} years` },
  ];

  function resetAll() {
    setIncome(DEFAULTS.income);
    setAssets(DEFAULTS.assets);
    setLiabilities(DEFAULTS.liabilities);
    setScenario(DEFAULTS.scenario);
    setStartJurisdiction(DEFAULTS.startJurisdiction);
    setPlanToAge(DEFAULTS.planToAge);
    setPaths(DEFAULTS.paths);
    clearLocal();
    window.history.replaceState(null, "", window.location.pathname);
  }

  return (
    <div className="app">
      <TopBar state={shared} onReset={resetAll} onSweep={runSweep} sweeping={sweeping}>
        <div className="topbar-title">Personal ALM Simulator</div>
        <div className="topbar-sub">
          Age {income.currentAge ?? 32} → {planToAge} ·{" "}
          {JURISDICTION_SHORT[startJurisdiction]} · {paths} paths
        </div>
      </TopBar>

      <div className="shell">
        <nav className="rail" aria-label="Sections">
          <div className="eyebrow rail-group" style={{ padding: "2px 11px 7px" }}>
            Configure
          </div>
          {NAV.map((n) => (
            <NavItem key={n.id} item={n} active={view} onSelect={setView} />
          ))}
          {compact ? (
            <NavItem
              item={{
                id: "networth",
                name: "Results",
                sum: currency(mc.terminalNetWorth.median),
              }}
              active={RESULT_VIEWS.includes(view) ? "networth" : view}
              onSelect={() =>
                setView(RESULT_VIEWS.includes(view) ? view : "networth")
              }
            />
          ) : (
            <>
              <div className="eyebrow rail-group" style={{ padding: "14px 11px 7px" }}>
                Results
              </div>
              {RESULTS.map((n) => (
                <NavItem key={n.id} item={n} active={view} onSelect={setView} />
              ))}
            </>
          )}
          <div className="rail-spacer" style={{ flex: "1 1 auto" }} />
          <div className="card flat rail-plan" style={{ padding: "12px 13px" }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Your plan
            </div>
            <div className="readout" style={{ lineHeight: 2 }}>
              Retire at <b>{income.retirementAge ?? 60}</b>
              <br />
              Save <b>{assets.contributionRatePct}%</b> a year
              <br />
              Spend <b>{currency(spend)}</b> a year
            </div>
          </div>
        </nav>

        <main className="main">
          {warnings.map((w) => (
            <div className="warning" key={w}>
              <WarnIcon />
              <span>{w}</span>
            </div>
          ))}

          {view === "income" && (
            <IncomeSection
              income={income}
              planToAge={planToAge}
              horizonYears={horizonYears}
              live={live}
              onIncome={(p) => setIncome({ ...income, ...p })}
              onPlanToAge={setPlanToAge}
            />
          )}

          {view === "assets" && (
            <AssetsSection
              assets={assets}
              salary={income.baseSalary}
              onAssets={(p) => setAssets({ ...assets, ...p })}
            />
          )}

          {view === "liabilities" && (
            <LiabilitiesSection
              liabilities={liabilities}
              onLiabilities={(p) => setLiabilities({ ...liabilities, ...p })}
            />
          )}

          {view === "scenario" && (
            <ScenarioSection
              scenario={scenario}
              startJurisdiction={startJurisdiction}
              startYear={income.startYear}
              paths={paths}
              band={band}
              onScenario={(p) => setScenario({ ...scenario, ...p })}
              onStartJurisdiction={setStartJurisdiction}
              onPaths={setPaths}
              onBand={setBand}
            />
          )}

          {compact && RESULT_VIEWS.includes(view) && (
            <div style={{ marginBottom: 16 }}>
              <Segmented
                ariaLabel="Result view"
                value={view}
                options={RESULTS.map((r) => ({ value: r.id, label: r.name }))}
                onChange={setView}
              />
            </div>
          )}

          {view === "networth" && (
            <div className="enter">
              <SectionHead
                title="Net worth over time"
                sub={`Median path across ${paths} simulated runs, with the ${bandSpec.label} percentile band. Every path uses the same configs and differs only in its market draw.`}
              />
              <Card style={{ marginBottom: 16 }}>
                <div className="legend">
                  <span>
                    <span className="swatch" style={{ background: "var(--acc)" }} />
                    Median path
                  </span>
                  <span style={{ color: "var(--tm)" }}>
                    Shaded band = {bandSpec.label} percentile
                  </span>
                </div>
                <Chart
                  series={[
                    {
                      label: "Median net worth",
                      color: "var(--acc)",
                      fill: "var(--acc-fill)",
                      points: mc.netWorthBands.map((b) => ({ x: b.year, y: b.median })),
                      band: mc.netWorthBands.map((b) => ({
                        x: b.year,
                        lo: b[bandSpec.lo as "p10" | "p25"],
                        hi: b[bandSpec.hi as "median" | "p75" | "p90"],
                      })),
                    },
                  ]}
                  aspect={3}
                  minHeight={240}
                  maxHeight={360}
                  xLabel="Year"
                  yLabel="Net worth"
                />
              </Card>
              <Card title="Tax assumptions in play">
                <ul className="notes">
                  {jurisdictionsUsed.flatMap((j) =>
                    JURISDICTIONS[j].notes.map((n) => (
                      <li key={`${j}-${n}`}>
                        <strong>{JURISDICTIONS[j].label}:</strong> {n}
                      </li>
                    )),
                  )}
                </ul>
              </Card>
            </div>
          )}

          {view === "spending" && (
            <div className="enter">
              <SectionHead
                title="Spending by category"
                sub={`Each category inflates at its own rate and responds to a move by its own amount. Non-essential lines are cut by ${liabilities.postExitDiscretionaryCutPct ?? 0}% once wage income stops.`}
                pill={`${currency(spend)} a year today`}
              />
              <Card>
                <ExpenseBreakdown
                  years={mc.representativePath.years}
                  oneTimeLabels={(liabilities.oneTimeLiabilities ?? []).map((o) => o.label)}
                />
              </Card>
            </div>
          )}

          {view === "gains" && (
            <div className="enter">
              <SectionHead
                title="Capital gains"
                sub="Growth in a taxable account is untaxed until something forces a sale, and then only the gain portion is taxed. This is the embedded liability you are carrying, and the years where a sale actually crystallised some of it."
                pill={`${currency(mc.representativePath.totalRealizedGains)} realized over the plan`}
              />
              <CapitalGains path={mc.representativePath} config={config} />
            </div>
          )}

          {view === "sensitivity" && (
            <div className="enter">
              <SectionHead
                title="Allocation sensitivity"
                sub="Sweep US Treasuries from 0% to 60%, holding the rest of the mix proportional, and re-run the whole simulation at each point — under the base case and under a correlated stress. Every allocation faces the same market draws, so the differences are the allocation, not noise."
              />
              {sweeps ? (
                <Card>
                  <SensitivityPanels sweeps={sweeps} band={band} />
                </Card>
              ) : (
                <div className="empty">
                  {sweeping
                    ? "Running the sweep…"
                    : "Not run yet. The sweep re-runs the full simulation at seven allocations under two scenarios, so it takes a moment."}
                  <div style={{ marginTop: 14 }}>
                    <button className="btn primary" onClick={runSweep} disabled={sweeping}>
                      {sweeping ? "Running…" : "Run allocation sweep"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {view === "ledger" && (
            <div className="enter">
              <SectionHead
                title="Ledger"
                sub="The single simulated path whose terminal net worth is closest to the median. Tinted rows forced a sale; red rows could not fund the year at all."
                pill={`${mc.representativePath.years.filter((y) => y.withdrawal > 0).length} forced-sale years`}
              />
              <Card>
                <Ledger path={mc.representativePath} />
              </Card>
            </div>
          )}

          <div className="disclaimer" style={{ marginTop: 24 }}>
            <strong>What this is and isn't.</strong> A planning and education
            tool that shows how allocations behave under stated assumptions. It
            does not produce a recommendation, and nothing here is investment,
            tax, or legal advice. Bracket tables are 2025 approximations indexed
            forward by your inflation assumption; they ignore credits,
            phase-outs, itemized deductions, AMT, RMDs, and state-specific
            nonresident-credit situations. Capital market assumptions are
            planning inputs, not forecasts.
          </div>
        </main>

        <OutcomeRail
          live={live}
          mc={mc}
          mcStale={mcStale}
          band={band}
          endAge={planToAge}
          startYear={income.startYear}
        />
      </div>
    </div>
  );
}

function NavItem({
  item,
  active,
  onSelect,
}: {
  item: { id: View; name: string; sum: string };
  active: View;
  onSelect: (v: View) => void;
}) {
  return (
    <button
      className={active === item.id ? "nav on" : "nav"}
      aria-current={active === item.id ? "page" : undefined}
      onClick={() => onSelect(item.id)}
    >
      <span className="nav-ico">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={ICONS[item.id]} />
        </svg>
      </span>
      <span className="nav-txt">
        <span className="nav-name">{item.name}</span>
        <span className="nav-sum">{item.sum}</span>
      </span>
    </button>
  );
}

/**
 * The whole config lives in the URL hash, so a preset is just a link. Clipboard
 * access needs a secure context, which http://<lan-ip> is not — so the URL is
 * always shown in a selectable field as the fallback.
 */
function TopBar({
  state,
  onReset,
  onSweep,
  sweeping,
  children,
}: {
  state: SharedState;
  onReset: () => void;
  onSweep: () => void;
  sweeping: boolean;
  children: React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function share() {
    const next = shareUrlFor(state);
    setUrl(next);
    window.history.replaceState(null, "", next);
    try {
      await navigator.clipboard.writeText(next);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="mark" aria-hidden="true">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 18l5-6 4 3 5-8" />
            <path d="M3 21h18" />
          </svg>
        </div>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>{children}</div>
        <button className="btn" onClick={share}>
          {copied ? "Link copied" : "Share"}
        </button>
        <button className="btn" onClick={onReset}>
          Reset
        </button>
        <button className="btn primary" onClick={onSweep} disabled={sweeping}>
          {sweeping ? "Running…" : "Run sweep"}
        </button>
      </header>
      {url && (
        <div
          className="share-bar"
          style={{
            padding: "9px 16px",
            borderBottom: "1px solid var(--bd)",
            background: "var(--s1)",
          }}
        >
          <input
            ref={inputRef}
            readOnly
            value={url}
            aria-label="Shareable link"
            onFocus={(e) => e.currentTarget.select()}
          />
          <span className="chart-note">
            Carries every number in the config — treat it as you would the
            numbers themselves.
          </span>
          <button className="btn" onClick={() => setUrl(null)}>
            Hide
          </button>
        </div>
      )}
    </>
  );
}

function WarnIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--warn)"
      strokeWidth="2"
      strokeLinecap="round"
      style={{ flex: "0 0 auto", marginTop: 2 }}
      aria-hidden="true"
    >
      <path d="M12 8v5" />
      <path d="M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
