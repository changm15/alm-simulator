import {
  ASSET_CLASSES,
  AssetConfig,
  PathResult,
  ExpenseCategory,
  IncomeConfig,
  Jurisdiction,
  LiabilityConfig,
  RelocationEvent,
  ScenarioConfig,
} from "../engine/types";
import { CAPITAL_MARKET_ASSUMPTIONS, normalizeAllocation } from "../engine/market";
import { DEFAULT_EXPENSE_CATEGORIES, baseSpend } from "../engine/liabilities";
import { resolveExitYear, scheduledSalary } from "../engine/income";
import {
  BENEFIT_REFERENCE,
  BenefitSystem,
  cppFactor,
  oasFactor,
  RetirementBenefitConfig,
  socialSecurityFactor,
} from "../engine/benefits";
import { suggestedExpenseMultiplier } from "../engine/relocation";
import { JURISDICTIONS } from "../engine/tax";
import { BAND_OPTIONS, BandKey } from "../engine/simulate";
import {
  Card,
  Disclosure,
  Dot,
  NumberInput,
  Segmented,
  Slider,
  StackBar,
  TextInput,
} from "./controls";
import { ASSET_LABELS, CAT_COLORS, JURISDICTION_LABELS, JURISDICTION_SHORT } from "./labels";
import { Chart } from "./charts";
import { currency, currencyExact, pct } from "./format";

const TRAJECTORY_HINTS: Record<IncomeConfig["trajectory"], string> = {
  promotion_track: "A step-up every 3 years in real terms, up to a cap.",
  flat: "Salary keeps pace with inflation and nothing more.",
  schedule: "Type a figure per year; nominal, with no inflation added on top.",
  early_exit: "Income steps down at a year you choose.",
};

// ---------------------------------------------------------------- section head

export function SectionHead({
  title,
  sub,
  pill,
  pillTone,
}: {
  title: string;
  sub: string;
  pill?: string;
  pillTone?: "good" | "bad";
}) {
  return (
    <div className="sec-head">
      <div>
        <h1 className="sec-title">{title}</h1>
        <p className="sec-sub">{sub}</p>
      </div>
      {pill ? (
        <span className={pillTone ? `pill ${pillTone}` : "pill"}>{pill}</span>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------- income

export function IncomeSection({
  income,
  planToAge,
  horizonYears,
  live,
  onIncome,
  onPlanToAge,
}: {
  income: IncomeConfig;
  planToAge: number;
  horizonYears: number;
  /** The live deterministic run, for the before/after-tax readouts. */
  live: PathResult;
  onIncome: (patch: Partial<IncomeConfig>) => void;
  onPlanToAge: (v: number) => void;
}) {
  const ageNow = income.currentAge ?? 32;
  const ageRetire = income.retirementAge ?? 60;
  const retireYear = resolveExitYear(income);
  const earn = Math.max(0, ageRetire - ageNow);
  const draw = Math.max(0, planToAge - ageRetire);
  const span = Math.max(1, earn + draw);
  const ageBad = ageRetire <= ageNow || ageRetire >= planToAge;

  return (
    <div className="enter">
      <SectionHead
        title="Income"
        sub="What you earn, and for how long. Retirement is an age, and it applies on top of whichever trajectory you pick — you can be on a promotion track and still stop at 60."
        pill={`${currency(income.baseSalary)} base`}
      />

      <Card style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 14,
            marginBottom: 14,
          }}
        >
          <span className="eyebrow">Plan timeline</span>
          <span className="readout">
            <b>{earn}</b> years earning, then <b>{draw}</b> drawing down
          </span>
        </div>
        <StackBar
          segments={[
            { key: "earn", fraction: earn / span, color: "var(--cat-1)" },
            { key: "draw", fraction: draw / span, color: "var(--cat-4)" },
          ]}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 9,
          }}
          className="m"
        >
          <span style={{ fontSize: 11, color: "var(--tm)" }}>
            now · age {ageNow}
          </span>
          <span style={{ fontSize: 11, color: "var(--acc)" }}>
            retire {ageRetire}
            {retireYear ? ` · ${retireYear}` : ""}
          </span>
          <span style={{ fontSize: 11, color: "var(--tm)" }}>
            age {planToAge}
          </span>
        </div>
      </Card>

      <div className="cols">
        <Card title="Earnings">
          <div className="stack">
            <Segmented
              label="Trajectory"
              value={income.trajectory}
              hint={TRAJECTORY_HINTS[income.trajectory]}
              options={[
                { value: "promotion_track", label: "Promotion" },
                { value: "flat", label: "Flat" },
                { value: "schedule", label: "Schedule" },
                { value: "early_exit", label: "Early exit" },
              ]}
              onChange={(v) =>
                onIncome({
                  trajectory: v,
                  salarySchedule:
                    v === "schedule" && (income.salarySchedule ?? []).length === 0
                      ? seedSchedule(income)
                      : income.salarySchedule,
                  postScheduleGrowthPct: income.postScheduleGrowthPct ?? 4,
                })
              }
            />
            {income.trajectory !== "schedule" && (
              <NumberInput
                label="Base salary"
                prefix="$"
                step={5000}
                value={income.baseSalary}
                onChange={(v) => onIncome({ baseSalary: v })}
              />
            )}
            {income.trajectory === "promotion_track" && (
              <NumberInput
                label="Salary cap"
                suffix="× base"
                step={0.1}
                value={income.promotionCapMultiple ?? 3}
                onChange={(v) => onIncome({ promotionCapMultiple: v })}
                hint="In real terms, so the cap is a genuine multiple of today's salary."
              />
            )}
            <Segmented
              label="Filing status"
              value={income.filingStatus}
              options={[
                { value: "single", label: "Single" },
                { value: "married", label: "Married, jointly" },
              ]}
              onChange={(v) => onIncome({ filingStatus: v })}
            />
          </div>
        </Card>

        <Card title="Ages">
          <div className="stack">
            <div className="row-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <NumberInput
                label="Current"
                value={ageNow}
                onChange={(v) => onIncome({ currentAge: v })}
              />
              <NumberInput
                label="Retire at"
                value={ageRetire}
                onChange={(v) => onIncome({ retirementAge: v })}
              />
            </div>
            <Slider
              label="Plan through age"
              min={70}
              max={105}
              value={planToAge}
              display={String(planToAge)}
              onChange={onPlanToAge}
              hint={`${horizonYears} simulated years.`}
            />
            {ageBad && (
              <span className="pill bad">
                Retirement age must sit between your current age and the end of
                the plan
              </span>
            )}
            <Disclosure label="After you stop working">
              <div className="row-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <NumberInput
                  label="Replacement"
                  suffix="% of pay"
                  value={income.exitIncomeReplacementPct ?? 0}
                  onChange={(v) => onIncome({ exitIncomeReplacementPct: v })}
                />
                <NumberInput
                  label="Lasting"
                  suffix="yrs"
                  value={income.exitReplacementYears ?? 0}
                  onChange={(v) =>
                    onIncome({ exitReplacementYears: v || undefined })
                  }
                />
              </div>
              <p className="fh">
                Models severance or part-time work. Leave the duration at 0 for
                income that continues at the replacement rate.
              </p>
            </Disclosure>
          </div>
        </Card>

        {income.trajectory === "schedule" && (
          <Card title="Salary by year">
            <SalarySchedule income={income} onIncome={onIncome} />
          </Card>
        )}

        <Card title="Government benefit">
          <RetirementBenefitEditor
            benefit={income.retirementBenefit}
            retirementAge={ageRetire}
            onChange={(b) => onIncome({ retirementBenefit: b })}
          />
        </Card>
      </div>

      <TakeHome live={live} />
    </div>
  );
}

/**
 * Before and after tax, this year and across the plan.
 *
 * Both come straight from the engine rather than an effective-rate guess, so
 * the wedge shown here is the same one the projection is actually running on.
 */
function TakeHome({ live }: { live: PathResult }) {
  const y0 = live.years[0];
  if (!y0) return null;

  const afterTax = y0.totalIncome - y0.totalTax;
  const rate = y0.totalIncome > 0 ? (y0.totalTax / y0.totalIncome) * 100 : 0;
  const rows: { label: string; amount: number; color?: string }[] = [
    { label: "Wages", amount: y0.grossWageIncome },
    { label: "Other income", amount: y0.otherIncome },
    { label: "Government benefit", amount: y0.benefitNet },
  ].filter((r) => r.amount > 0);

  const taxRows = [
    { label: "Income tax", amount: y0.incomeTax, color: "var(--cat-2)" },
    { label: "Payroll tax", amount: y0.payrollTax, color: "var(--cat-4)" },
    { label: "Capital gains tax", amount: y0.capitalGainsTax, color: "var(--cat-5)" },
  ].filter((r) => r.amount > 0);

  // After-tax can fall below zero once wage income stops: the tax bill is then
  // driven by portfolio withdrawals, which are not "income" in this sense.
  const anyNegative = live.years.some((y) => y.totalIncome - y.totalTax < 0);

  return (
    <div className="cols" style={{ marginTop: 16 }}>
      <Card title={`Before and after tax — ${y0.year}`}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 12 }}>
          <div>
            <div className="eyebrow">Gross</div>
            <div className="m" style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
              {currencyExact(y0.totalIncome)}
            </div>
          </div>
          <div style={{ color: "var(--tm)", fontSize: 18 }}>&rarr;</div>
          <div>
            <div className="eyebrow">Take-home</div>
            <div
              className="m"
              style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--acc)" }}
            >
              {currencyExact(afterTax)}
            </div>
          </div>
          <span className="pill" style={{ marginLeft: "auto" }}>
            {pct(rate)} to tax
          </span>
        </div>

        <StackBar
          segments={[
            {
              key: "net",
              fraction: y0.totalIncome > 0 ? afterTax / y0.totalIncome : 0,
              color: "var(--acc)",
            },
            ...taxRows.map((t) => ({
              key: t.label,
              fraction: y0.totalIncome > 0 ? t.amount / y0.totalIncome : 0,
              color: t.color,
            })),
          ]}
          height={12}
        />

        <div className="readout" style={{ lineHeight: 2, marginTop: 12 }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{r.label}</span>
              <b>{currencyExact(r.amount)}</b>
            </div>
          ))}
          {taxRows.map((t) => (
            <div
              key={t.label}
              style={{ display: "flex", justifyContent: "space-between", color: "var(--tm)" }}
            >
              <span>
                <Dot color={t.color} /> {t.label}
              </span>
              <b style={{ color: "var(--ts)" }}>−{currencyExact(t.amount)}</b>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              borderTop: "1px solid var(--bd)",
              marginTop: 6,
              paddingTop: 6,
            }}
          >
            <span>
              <Dot color="var(--acc)" /> After tax
            </span>
            <b>{currencyExact(afterTax)}</b>
          </div>
        </div>
        {y0.taxAdvantagedContribution > 0 && (
          <p className="fh">
            Income tax is charged on{" "}
            {currencyExact(y0.ordinaryTaxableIncome)}, not the full gross,
            because {currencyExact(y0.taxAdvantagedContribution)} was deferred
            to the 401k/IRA. Payroll tax still applies to every dollar of wages.
            That deferral is inside the take-home figure — it is income you
            keep, just not in your current account.
          </p>
        )}
      </Card>

      <Card title="Across the plan">
        <div className="legend">
          <span>
            <span className="swatch" style={{ background: "var(--cat-3)" }} />
            Gross income
          </span>
          <span>
            <span className="swatch" style={{ background: "var(--acc)" }} />
            After tax
          </span>
        </div>
        <Chart
          series={[
            {
              label: "Gross income",
              color: "var(--cat-3)",
              points: live.years.map((y) => ({ x: y.year, y: y.totalIncome })),
            },
            {
              label: "After tax",
              color: "var(--acc)",
              fill: "var(--acc-fill)",
              points: live.years.map((y) => ({
                x: y.year,
                y: y.totalIncome - y.totalTax,
              })),
            },
          ]}
          aspect={2.3}
          minHeight={200}
          maxHeight={260}
          xLabel="Year"
          yLabel="Income"
        />
        <p className="fh">
          The gap between the lines is the tax wedge, in nominal dollars.
          {anyNegative
            ? " After wage income stops it can drop below zero: the bill is then driven by portfolio withdrawals, which the portfolio itself has to fund."
            : ""}
        </p>
      </Card>
    </div>
  );
}

const BENEFIT_DEFAULTS: Record<BenefitSystem, RetirementBenefitConfig> = {
  none: { system: "none", claimAge: 67 },
  us_social_security: {
    system: "us_social_security",
    claimAge: 67,
    monthlyAtFullRetirementAge: 2_000,
    fullRetirementAge: 67,
  },
  canada_cpp_oas: {
    system: "canada_cpp_oas",
    claimAge: 65,
    cppMonthlyAt65: 900,
    oasMonthlyAt65: 728,
  },
};

/**
 * Claiming is one of the few large levers left at retirement, so the editor
 * shows what the adjustment actually does to the cheque rather than making the
 * user look up a schedule.
 */
function RetirementBenefitEditor({
  benefit,
  retirementAge,
  onChange,
}: {
  benefit: RetirementBenefitConfig | undefined;
  retirementAge: number;
  onChange: (b: RetirementBenefitConfig) => void;
}) {
  const cfg = benefit ?? BENEFIT_DEFAULTS.none;
  const system = cfg.system;
  const patch = (p: Partial<RetirementBenefitConfig>) =>
    onChange({ ...cfg, ...p });

  if (system === "none") {
    return (
      <div className="stack">
        <Segmented
          label="System"
          value={system}
          options={[
            { value: "none", label: "None" },
            { value: "us_social_security", label: "US Social Security" },
            { value: "canada_cpp_oas", label: "Canada CPP + OAS" },
          ]}
          onChange={(v) => onChange(BENEFIT_DEFAULTS[v])}
        />
        <div className="empty">
          No government benefit modelled. Leaving one out overstates how much
          the portfolio has to fund — it is an inflation-indexed annuity for
          life, and it never runs out.
        </div>
      </div>
    );
  }

  const isUS = system === "us_social_security";
  const fra = cfg.fullRetirementAge ?? 67;
  const minAge = isUS ? 62 : 60;

  const factor = isUS ? socialSecurityFactor(cfg.claimAge, fra) : cppFactor(cfg.claimAge);
  const annual = isUS
    ? (cfg.monthlyAtFullRetirementAge ?? 0) * 12 * factor
    : (cfg.cppMonthlyAt65 ?? 0) * 12 * cppFactor(cfg.claimAge) +
      (cfg.oasMonthlyAt65 ?? 0) * 12 * oasFactor(Math.max(65, cfg.claimAge));

  const delta = Math.round((factor - 1) * 100);
  const neutral = isUS ? fra : 65;

  return (
    <div className="stack">
      <Segmented
        label="System"
        value={system}
        options={[
          { value: "none", label: "None" },
          { value: "us_social_security", label: "US Social Security" },
          { value: "canada_cpp_oas", label: "Canada CPP + OAS" },
        ]}
        onChange={(v) => onChange(BENEFIT_DEFAULTS[v])}
      />

      {isUS ? (
        <NumberInput
          label="Monthly benefit at full retirement age"
          prefix="$"
          step={50}
          value={cfg.monthlyAtFullRetirementAge ?? 0}
          onChange={(v) => patch({ monthlyAtFullRetirementAge: v })}
          hint={`Your PIA, from a Social Security statement. For reference the 2025 average is about $${BENEFIT_REFERENCE.usAverageMonthly.toLocaleString()} and the maximum about $${BENEFIT_REFERENCE.usMaxMonthlyAtFra.toLocaleString()}.`}
        />
      ) : (
        <div className="row-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <NumberInput
            label="CPP at 65"
            prefix="$"
            suffix="/mo"
            step={25}
            value={cfg.cppMonthlyAt65 ?? 0}
            onChange={(v) => patch({ cppMonthlyAt65: v })}
            hint={`2025 max about $${BENEFIT_REFERENCE.cppMaxMonthlyAt65.toLocaleString()}.`}
          />
          <NumberInput
            label="OAS at 65"
            prefix="$"
            suffix="/mo"
            step={10}
            value={cfg.oasMonthlyAt65 ?? 0}
            onChange={(v) => patch({ oasMonthlyAt65: v })}
            hint="2025 figure about $728."
          />
        </div>
      )}

      <Slider
        label="Claim at age"
        min={minAge}
        max={70}
        value={cfg.claimAge}
        display={`${cfg.claimAge}`}
        onChange={(v) => patch({ claimAge: v })}
        hint={
          cfg.claimAge === neutral
            ? `The unadjusted age. Claiming earlier cuts the cheque permanently; later raises it.`
            : `${delta > 0 ? "+" : ""}${delta}% against claiming at ${neutral}, for life.`
        }
      />

      <Card flat>
        <div className="readout" style={{ lineHeight: 1.9 }}>
          Pays <b>{currencyExact(annual)}</b> a year from age{" "}
          <b>{cfg.claimAge}</b>, in today&rsquo;s dollars and indexed for life.
        </div>
        <p className="fh">
          {cfg.claimAge > retirementAge
            ? `You stop working at ${retirementAge}, so the portfolio funds ${cfg.claimAge - retirementAge} year${cfg.claimAge - retirementAge === 1 ? "" : "s"} alone before this starts.`
            : "It begins at or before you stop working."}
          {isUS
            ? " Up to 85% is federally taxable depending on your other income, and it is exempt from state tax in every jurisdiction here."
            : " CPP and OAS are ordinary income, and OAS is clawed back at 15% of income above roughly $93k."}
        </p>
      </Card>
    </div>
  );
}

function seedSchedule(income: IncomeConfig) {
  return [0, 1, 2].map((i) => ({
    year: income.startYear + i,
    salary: Math.round(income.baseSalary * (1 + i * 0.05)),
  }));
}

function SalarySchedule({
  income,
  onIncome,
}: {
  income: IncomeConfig;
  onIncome: (patch: Partial<IncomeConfig>) => void;
}) {
  const schedule = income.salarySchedule ?? [];
  const sorted = [...schedule].sort((a, b) => a.year - b.year);
  const last = sorted[sorted.length - 1];

  return (
    <div>
      <div
        className="row-grid eyebrow"
        style={{ gridTemplateColumns: "84px 1fr 32px", marginBottom: 6 }}
      >
        <span>Year</span>
        <span style={{ textAlign: "right" }}>Salary</span>
        <span />
      </div>
      {schedule.map((e, i) => (
        <div
          key={i}
          className="row-grid"
          style={{ gridTemplateColumns: "84px 1fr 32px", marginBottom: 6 }}
        >
          <div className="ctl" style={{ marginTop: 0, height: 34 }}>
            <input
              type="number"
              aria-label="Year"
              value={e.year}
              onChange={(ev) =>
                onIncome({
                  salarySchedule: schedule.map((x, k) =>
                    k === i ? { ...x, year: Number(ev.target.value) } : x,
                  ),
                })
              }
            />
          </div>
          <div className="ctl pre" style={{ marginTop: 0, height: 34 }}>
            <span className="adorn">$</span>
            <input
              type="number"
              step={1000}
              aria-label={`Salary in ${e.year}`}
              value={e.salary}
              onChange={(ev) =>
                onIncome({
                  salarySchedule: schedule.map((x, k) =>
                    k === i ? { ...x, salary: Number(ev.target.value) } : x,
                  ),
                })
              }
            />
          </div>
          <button
            className="btn"
            style={{ padding: "6px 0", justifyContent: "center" }}
            aria-label={`Remove ${e.year}`}
            onClick={() =>
              onIncome({ salarySchedule: schedule.filter((_, k) => k !== i) })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="btn"
        style={{ marginTop: 4 }}
        onClick={() =>
          onIncome({
            salarySchedule: [
              ...schedule,
              {
                year: last ? last.year + 1 : income.startYear,
                salary: last
                  ? Math.round(last.salary * 1.05)
                  : income.baseSalary,
              },
            ],
          })
        }
      >
        + Add year
      </button>

      <div style={{ marginTop: 14 }}>
        <NumberInput
          label="Growth after the last year"
          suffix="%/yr"
          step={0.1}
          value={income.postScheduleGrowthPct ?? 0}
          onChange={(v) => onIncome({ postScheduleGrowthPct: v })}
          hint={
            last ? (
              <>
                Figures are nominal — no inflation is added on top. A year you
                skip holds the previous figure. Past {last.year} that gives{" "}
                {[1, 3, 5]
                  .map(
                    (d) =>
                      `${last.year + d}: ${currencyExact(scheduledSalary(income, last.year + d) ?? 0)}`,
                  )
                  .join(", ")}
                .
              </>
            ) : (
              "Figures are nominal — no inflation is added on top."
            )
          }
        />
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- assets

export function AssetsSection({
  assets,
  salary,
  onAssets,
}: {
  assets: AssetConfig;
  salary: number;
  onAssets: (patch: Partial<AssetConfig>) => void;
}) {
  const alloc = assets.allocation;
  const total = ASSET_CLASSES.reduce((a, c) => a + alloc[c], 0);
  const normalized = total > 0 ? normalizeAllocation(alloc) : alloc;
  const expRet =
    total > 0
      ? ASSET_CLASSES.reduce(
          (a, c) => a + normalized[c] * CAPITAL_MARKET_ASSUMPTIONS[c].mean,
          0,
        ) * 100
      : 0;
  const equity = normalized.usEquity + normalized.intlEquity;

  const taxableShare = assets.accountSplit.taxable;
  const save = salary * (assets.contributionRatePct / 100);
  const wantAdv = save * ((assets.taxAdvantagedContributionSharePct ?? 0) / 100);
  const limit = assets.annualTaxAdvantagedLimit ?? 23_500;
  const adv = Math.min(wantAdv, limit);

  return (
    <div className="enter">
      <SectionHead
        title="Assets"
        sub="What you hold, how it splits across account types, and how much of your income you are saving. A traditional 401k contribution is deducted from this year's taxable income and taxed on withdrawal; a Roth is the reverse."
        pill={`${pct(expRet)} expected a year`}
      />

      <div className="cols" style={{ marginBottom: 16 }}>
        <Card title="Balances">
          <div className="stack">
            <div className="row-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <NumberInput
                label="Invested"
                prefix="$"
                step={10000}
                value={assets.currentBalance}
                onChange={(v) => onAssets({ currentBalance: v })}
              />
              <NumberInput
                label="Cash buffer"
                prefix="$"
                step={5000}
                value={assets.startingCashBuffer ?? 0}
                onChange={(v) => onAssets({ startingCashBuffer: v })}
              />
            </div>
            <div>
              <Slider
                label="Split across account types"
                value={Math.round(taxableShare * 100)}
                step={5}
                display={`${Math.round(taxableShare * 100)}% taxable`}
                onChange={(v) =>
                  onAssets({
                    accountSplit: { taxable: v / 100, taxAdvantaged: 1 - v / 100 },
                  })
                }
              />
              <StackBar
                segments={[
                  { key: "tax", fraction: taxableShare, color: "var(--cat-1)" },
                  { key: "adv", fraction: 1 - taxableShare, color: "var(--cat-7)" },
                ]}
              />
              <div
                className="readout"
                style={{ display: "flex", justifyContent: "space-between", marginTop: 9 }}
              >
                <span>
                  <Dot color="var(--cat-1)" /> Taxable{" "}
                  <b>{currency(assets.currentBalance * taxableShare)}</b>
                </span>
                <span>
                  <Dot color="var(--cat-7)" /> 401k/IRA{" "}
                  <b>{currency(assets.currentBalance * (1 - taxableShare))}</b>
                </span>
              </div>
            </div>
            <Disclosure label="Cost basis and contribution limit">
              <div className="row-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <NumberInput
                  label="Cost basis"
                  suffix="%"
                  step={5}
                  value={Math.round(assets.costBasisFraction * 100)}
                  onChange={(v) => onAssets({ costBasisFraction: v / 100 })}
                />
                <NumberInput
                  label="401k annual limit"
                  prefix="$"
                  step={500}
                  value={limit}
                  onChange={(v) => onAssets({ annualTaxAdvantagedLimit: v })}
                />
              </div>
              <p className="fh">
                About{" "}
                {currency(
                  assets.currentBalance *
                    taxableShare *
                    (1 - assets.costBasisFraction),
                )}{" "}
                of unrealized gain sits in the taxable account today. It seeds
                the starting basis only — after that the engine tracks it.
              </p>
            </Disclosure>
          </div>
        </Card>

        <Card title="Saving">
          <div className="stack">
            <Slider
              label="Target savings rate"
              max={60}
              value={assets.contributionRatePct}
              display={`${assets.contributionRatePct}% · ${currency(save)}`}
              onChange={(v) => onAssets({ contributionRatePct: v })}
              hint="Anything you could save beyond this lands in the cash buffer, which is drawn down before any asset is sold."
            />
            <Card flat title="Where it goes">
              <StackBar
                segments={[
                  { key: "adv", fraction: save > 0 ? adv / save : 0, color: "var(--cat-7)" },
                  { key: "tax", fraction: save > 0 ? (save - adv) / save : 0, color: "var(--cat-1)" },
                ]}
              />
              <div className="readout" style={{ lineHeight: 2, marginTop: 10 }}>
                <Dot color="var(--cat-7)" /> 401k/IRA{" "}
                <b>{currencyExact(adv)}</b>
                {wantAdv > limit ? " (at the cap)" : ""}
                <br />
                <Dot color="var(--cat-1)" /> Taxable{" "}
                <b>{currencyExact(save - adv)}</b>
              </div>
            </Card>
            <Slider
              label="Share routed to 401k/IRA"
              step={5}
              value={assets.taxAdvantagedContributionSharePct ?? 0}
              display={`${assets.taxAdvantagedContributionSharePct ?? 0}%`}
              onChange={(v) => onAssets({ taxAdvantagedContributionSharePct: v })}
            />
            <Segmented
              label="Account type"
              value={
                assets.taxAdvantagedContributionsArePreTax === false
                  ? "roth"
                  : "traditional"
              }
              options={[
                { value: "traditional", label: "Traditional" },
                { value: "roth", label: "Roth" },
              ]}
              onChange={(v) =>
                onAssets({ taxAdvantagedContributionsArePreTax: v === "traditional" })
              }
              hint={
                assets.taxAdvantagedContributionsArePreTax === false
                  ? "Contributed after tax, withdrawn tax free."
                  : "Deducted from this year's taxable income, taxed on withdrawal. Payroll tax still applies."
              }
            />
          </div>
        </Card>
      </div>

      <Card
        title="Allocation"
        right={
          <span className={total === 100 ? "pill good" : "pill bad"}>
            {total === 100 ? "Adds to 100%" : `${Math.round(total * 100)}% — normalized on run`}
          </span>
        }
      >
        <StackBar
          height={12}
          segments={ASSET_CLASSES.map((c, i) => ({
            key: c,
            fraction: normalized[c],
            color: CAT_COLORS[i],
          }))}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "10px 28px",
            marginTop: 16,
          }}
        >
          {ASSET_CLASSES.map((c, i) => (
            <div key={c} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Dot color={CAT_COLORS[i]} />
              <span
                className="fl"
                style={{ width: 118, flex: "0 0 auto", fontWeight: 400 }}
              >
                {ASSET_LABELS[c]}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                aria-label={ASSET_LABELS[c]}
                value={Math.round(alloc[c] * 100)}
                onChange={(e) =>
                  onAssets({
                    allocation: { ...alloc, [c]: Number(e.target.value) / 100 },
                  })
                }
              />
              <span className="m" style={{ fontSize: 12.5, width: 36, textAlign: "right" }}>
                {Math.round(alloc[c] * 100)}%
              </span>
            </div>
          ))}
        </div>
        <div
          className="readout"
          style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--bd)" }}
        >
          Growth assets <b>{Math.round(equity * 100)}%</b> · Defensive{" "}
          <b>{Math.round((1 - equity) * 100)}%</b> · Expected <b>{pct(expRet)}</b> a
          year before inflation
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- liabilities

function colLevel(v: number): "none" | "some" | "full" {
  return v >= 0.8 ? "full" : v <= 0.2 ? "none" : "some";
}

export function LiabilitiesSection({
  liabilities,
  onLiabilities,
}: {
  liabilities: LiabilityConfig;
  onLiabilities: (patch: Partial<LiabilityConfig>) => void;
}) {
  const cats = liabilities.expenseCategories ?? DEFAULT_EXPENSE_CATEGORIES;
  const spend = baseSpend(liabilities);
  const essential = cats.reduce((a, c) => a + (c.essential ? c.annualAmount : 0), 0);
  const discretionary = spend - essential;
  const cut = liabilities.postExitDiscretionaryCutPct ?? 0;

  const patchCat = (i: number, patch: Partial<ExpenseCategory>) =>
    onLiabilities({
      expenseCategories: cats.map((c, k) => (k === i ? { ...c, ...patch } : c)),
    });

  const events = liabilities.oneTimeLiabilities ?? [];

  return (
    <div className="enter">
      <SectionHead
        title="Liabilities"
        sub="The spending plan. Each line inflates at its own rate and responds to a move by its own amount — housing tracks local cost of living, a streaming subscription does not. Amounts are in today's dollars."
        pill={`${currencyExact(spend)} a year`}
      />

      <div className="cols" style={{ marginBottom: 16 }}>
        <Card>
          <div
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}
          >
            <div>
              <div className="eyebrow">Annual spending plan</div>
              <div
                className="m"
                style={{ fontSize: 26, fontWeight: 600, marginTop: 6, letterSpacing: "-0.03em" }}
              >
                {currencyExact(spend)}
              </div>
              <p className="fh">Before one-time events.</p>
            </div>
            <div style={{ flex: "0 0 160px" }}>
              <StackBar
                segments={[
                  { key: "e", fraction: spend > 0 ? essential / spend : 0, color: "var(--cat-1)" },
                  { key: "d", fraction: spend > 0 ? discretionary / spend : 0, color: "var(--cat-4)" },
                ]}
              />
              <div className="readout" style={{ fontSize: 11.5, lineHeight: 1.9, marginTop: 9 }}>
                <Dot color="var(--cat-1)" /> Essential {currency(essential)}
                <br />
                <Dot color="var(--cat-4)" /> Discretionary {currency(discretionary)}
              </div>
            </div>
          </div>
        </Card>

        <Card title="Assumptions">
          <div className="stack">
            <div className="row-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <NumberInput
                label="Inflation"
                suffix="%"
                step={0.1}
                value={liabilities.inflationAssumptionPct}
                onChange={(v) => onLiabilities({ inflationAssumptionPct: v })}
              />
              <NumberInput
                label="Income floor"
                prefix="$"
                step={5000}
                value={liabilities.retirementIncomeTargetAnnual ?? 0}
                onChange={(v) => onLiabilities({ retirementIncomeTargetAnnual: v })}
              />
            </div>
            <Slider
              label="Cut discretionary at retirement"
              step={5}
              value={cut}
              display={`${cut}%`}
              onChange={(v) => onLiabilities({ postExitDiscretionaryCutPct: v })}
              hint={`Saves ${currency((discretionary * cut) / 100)} a year once wage income stops. Only lines marked non-essential are cut.`}
            />
          </div>
        </Card>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div className="table-wrap">
          <table className="cats">
            <thead>
              <tr>
                <th style={{ width: "26%" }}>Category</th>
                <th style={{ width: "15%" }}>Amount a year</th>
                <th style={{ width: "17%" }}>Share</th>
                <th style={{ width: "11%" }}>Inflation</th>
                <th style={{ width: "20%" }}>Tracks cost of living</th>
                <th style={{ width: "11%" }}>Essential</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c, i) => (
                <tr key={i}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Dot color={CAT_COLORS[i % CAT_COLORS.length]} />
                      <TextInput
                        ariaLabel="Category name"
                        value={c.label}
                        onChange={(v) => patchCat(i, { label: v })}
                      />
                    </div>
                  </td>
                  <td>
                    <div className="ctl pre">
                      <span className="adorn">$</span>
                      <input
                        type="number"
                        step={500}
                        aria-label={`${c.label} amount`}
                        value={c.annualAmount}
                        onChange={(e) =>
                          patchCat(i, { annualAmount: Number(e.target.value) })
                        }
                      />
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div
                        style={{
                          flex: "1 1 auto",
                          height: 6,
                          borderRadius: 3,
                          background: "var(--s3)",
                        }}
                      >
                        <div
                          style={{
                            width: `${spend > 0 ? (c.annualAmount / spend) * 100 : 0}%`,
                            height: 6,
                            borderRadius: 3,
                            background: CAT_COLORS[i % CAT_COLORS.length],
                          }}
                        />
                      </div>
                      <span
                        className="m"
                        style={{ fontSize: 11, color: "var(--tm)", width: 32, textAlign: "right" }}
                      >
                        {spend > 0 ? Math.round((c.annualAmount / spend) * 100) : 0}%
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="ctl suf">
                      <input
                        type="number"
                        step={0.1}
                        aria-label={`${c.label} inflation`}
                        value={c.inflationPct ?? liabilities.inflationAssumptionPct}
                        onChange={(e) =>
                          patchCat(i, { inflationPct: Number(e.target.value) })
                        }
                      />
                      <span className="adorn suf">%</span>
                    </div>
                  </td>
                  <td>
                    <Segmented
                      small
                      ariaLabel={`${c.label} cost of living sensitivity`}
                      value={colLevel(c.colSensitivity ?? 1)}
                      options={[
                        { value: "none", label: "None" },
                        { value: "some", label: "Some" },
                        { value: "full", label: "Full" },
                      ]}
                      onChange={(v) =>
                        patchCat(i, {
                          colSensitivity: v === "none" ? 0 : v === "some" ? 0.5 : 1,
                        })
                      }
                    />
                  </td>
                  <td>
                    <Segmented
                      small
                      ariaLabel={`${c.label} essential`}
                      value={c.essential ? "yes" : "no"}
                      options={[
                        { value: "yes", label: "Yes" },
                        { value: "no", label: "No" },
                      ]}
                      onChange={(v) => patchCat(i, { essential: v === "yes" })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
            marginTop: 16,
            paddingTop: 14,
            borderTop: "1px solid var(--bd)",
          }}
        >
          <button
            className="btn"
            onClick={() =>
              onLiabilities({
                expenseCategories: [
                  ...cats,
                  {
                    label: "New category",
                    annualAmount: 3000,
                    colSensitivity: 0.5,
                    essential: false,
                  },
                ],
              })
            }
          >
            + Add category
          </button>
          <span className="fh" style={{ margin: 0, maxWidth: "52ch", textAlign: "right" }}>
            "Tracks cost of living" decides how much of a line moves when you
            relocate. Rent follows a move; a subscription does not.
          </span>
        </div>
      </Card>

      <Card title="One-time events" right={<span className="readout">{events.length} planned</span>}>
        <div className="stack" style={{ gap: 8 }}>
          {events.map((e, i) => (
            <div
              key={i}
              className="row-grid"
              style={{ gridTemplateColumns: "1fr 110px 160px 34px" }}
            >
              <TextInput
                ariaLabel="Event name"
                value={e.label}
                onChange={(v) =>
                  onLiabilities({
                    oneTimeLiabilities: events.map((x, k) =>
                      k === i ? { ...x, label: v } : x,
                    ),
                  })
                }
              />
              <div className="ctl" style={{ marginTop: 0 }}>
                <input
                  type="number"
                  aria-label="Year"
                  value={e.year}
                  onChange={(ev) =>
                    onLiabilities({
                      oneTimeLiabilities: events.map((x, k) =>
                        k === i ? { ...x, year: Number(ev.target.value) } : x,
                      ),
                    })
                  }
                />
              </div>
              <div className="ctl pre" style={{ marginTop: 0 }}>
                <span className="adorn">$</span>
                <input
                  type="number"
                  step={5000}
                  aria-label="Amount"
                  value={e.amount}
                  onChange={(ev) =>
                    onLiabilities({
                      oneTimeLiabilities: events.map((x, k) =>
                        k === i ? { ...x, amount: Number(ev.target.value) } : x,
                      ),
                    })
                  }
                />
              </div>
              <button
                className="btn"
                style={{ padding: "8px 0", justifyContent: "center" }}
                aria-label={`Remove ${e.label}`}
                onClick={() =>
                  onLiabilities({
                    oneTimeLiabilities: events.filter((_, k) => k !== i),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          {events.length === 0 && (
            <div className="empty">
              No one-time events. A wedding or a down payment lands as a single
              outlay, in today's dollars, inflated to the year it falls in.
            </div>
          )}
        </div>
        <button
          className="btn"
          style={{ marginTop: 12 }}
          onClick={() =>
            onLiabilities({
              oneTimeLiabilities: [
                ...events,
                {
                  label: "New event",
                  year: new Date().getFullYear() + 5,
                  amount: 50_000,
                },
              ],
            })
          }
        >
          + Add event
        </button>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------- scenario

const MARKET_NOTES = {
  optimistic: { ret: "+2.0 pts", note: "Equities above long-run means." },
  base: { ret: "long-run", note: "Historical means, no adjustment." },
  pessimistic: { ret: "−2.5 pts", note: "A sustained low-return decade." },
} as const;

const STRESS_NOTES = [
  { value: "none", label: "None", note: "Market and personal events stay independent." },
  {
    value: "recession_plus_layoff",
    label: "Recession + layoff",
    note: "18 months out of work, landing in the same year as the drawdown.",
  },
  {
    value: "recession_plus_expense_shock",
    label: "Recession + expense shock",
    note: "A forced, unavoidable outlay in the same year as the drawdown.",
  },
] as const;

export function ScenarioSection({
  scenario,
  startJurisdiction,
  startYear,
  paths,
  band,
  onScenario,
  onStartJurisdiction,
  onPaths,
  onBand,
}: {
  scenario: ScenarioConfig;
  startJurisdiction: Jurisdiction;
  startYear: number;
  paths: number;
  band: BandKey;
  onScenario: (patch: Partial<ScenarioConfig>) => void;
  onStartJurisdiction: (j: Jurisdiction) => void;
  onPaths: (n: number) => void;
  onBand: (b: BandKey) => void;
}) {
  const shockOn = scenario.shockYear !== undefined;
  const relocations = scenario.relocationEvents ?? [];
  const stress = scenario.correlatedStressPreset ?? "none";

  return (
    <div className="enter">
      <SectionHead
        title="Scenario"
        sub="The world the plan runs in. Correlated presets tie the market leg and the personal leg to the same year, because in reality they are the same event."
        pill={`${paths} paths`}
      />

      <div className="cols">
        <div className="stack">
          <Card title="Market path">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 10,
              }}
            >
              {(["optimistic", "base", "pessimistic"] as const).map((id) => {
                const on = scenario.marketPath === id;
                return (
                  <button
                    key={id}
                    onClick={() => onScenario({ marketPath: id })}
                    style={{
                      cursor: "pointer",
                      textAlign: "left",
                      border: `1px solid ${on ? "var(--acc)" : "var(--bd)"}`,
                      background: on ? "var(--acc-soft)" : "var(--s2)",
                      borderRadius: 11,
                      padding: 13,
                      color: "inherit",
                      font: "inherit",
                      transition: "border-color .16s ease, background .16s ease",
                    }}
                  >
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                      {id[0].toUpperCase() + id.slice(1)}
                    </span>
                    <span
                      className="m"
                      style={{
                        display: "block",
                        fontSize: 15,
                        marginTop: 7,
                        color: on ? "var(--acc)" : "var(--ts)",
                      }}
                    >
                      {MARKET_NOTES[id].ret}
                    </span>
                    <span className="fh" style={{ display: "block" }}>
                      {MARKET_NOTES[id].note}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}
            >
              <div>
                <div className="fl">Market shock</div>
                <p className="fh">A sharp drawdown in one specific year.</p>
              </div>
              <div style={{ flex: "0 0 132px" }}>
                <Segmented
                  ariaLabel="Market shock"
                  value={shockOn ? "on" : "off"}
                  options={[
                    { value: "off", label: "Off" },
                    { value: "on", label: "On" },
                  ]}
                  onChange={(v) =>
                    onScenario(
                      v === "on"
                        ? {
                            shockYear: scenario.shockYear ?? startYear + 5,
                            shockMagnitudePct: scenario.shockMagnitudePct ?? -30,
                          }
                        : { shockYear: undefined, shockMagnitudePct: undefined },
                    )
                  }
                />
              </div>
            </div>
            {shockOn && (
              <div
                className="row-grid"
                style={{
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: "1px solid var(--bd)",
                }}
              >
                <NumberInput
                  label="Year"
                  value={scenario.shockYear ?? startYear + 5}
                  onChange={(v) => onScenario({ shockYear: v })}
                />
                <NumberInput
                  label="Equity drawdown"
                  suffix="%"
                  value={scenario.shockMagnitudePct ?? -30}
                  onChange={(v) => onScenario({ shockMagnitudePct: v })}
                />
              </div>
            )}
          </Card>

          <Card title="Correlated stress">
            <div className="stack" style={{ gap: 9 }}>
              {STRESS_NOTES.map((o) => {
                const on = stress === o.value;
                return (
                  <button
                    key={o.value}
                    onClick={() =>
                      onScenario({
                        correlatedStressPreset:
                          o.value === "none"
                            ? null
                            : (o.value as NonNullable<
                                ScenarioConfig["correlatedStressPreset"]
                              >),
                        shockYear:
                          o.value === "none"
                            ? scenario.shockYear
                            : (scenario.shockYear ?? startYear + 5),
                        shockMagnitudePct:
                          o.value === "none"
                            ? scenario.shockMagnitudePct
                            : (scenario.shockMagnitudePct ?? -30),
                      })
                    }
                    style={{
                      cursor: "pointer",
                      textAlign: "left",
                      border: `1px solid ${on ? "var(--acc)" : "var(--bd)"}`,
                      background: on ? "var(--acc-soft)" : "var(--s2)",
                      borderRadius: 11,
                      padding: 13,
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      color: "inherit",
                      font: "inherit",
                      transition: "border-color .16s ease, background .16s ease",
                    }}
                  >
                    <span
                      style={{
                        flex: "0 0 auto",
                        width: 15,
                        height: 15,
                        borderRadius: "50%",
                        border: `2px solid ${on ? "var(--acc)" : "var(--tm)"}`,
                        background: on ? "var(--acc)" : "transparent",
                        marginTop: 2,
                      }}
                    />
                    <span style={{ flex: "1 1 auto" }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                        {o.label}
                      </span>
                      <span className="fh" style={{ display: "block" }}>
                        {o.note}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title="Where you live">
            <Segmented
              ariaLabel="Starting city"
              value={startJurisdiction}
              options={(Object.keys(JURISDICTION_SHORT) as Jurisdiction[]).map((j) => ({
                value: j,
                label: JURISDICTION_SHORT[j],
              }))}
              onChange={onStartJurisdiction}
              hint={JURISDICTIONS[startJurisdiction].notes[0]}
            />
          </Card>

          <Card
            title="Relocations"
            right={
              <button
                className="btn"
                style={{ padding: "5px 11px" }}
                onClick={() =>
                  onScenario({
                    relocationEvents: [
                      ...relocations,
                      {
                        year: startYear + 5,
                        toJurisdiction: "seattle",
                        expenseLevelMultiplier: Number(
                          suggestedExpenseMultiplier(startJurisdiction, "seattle").toFixed(2),
                        ),
                        incomeMultiplier: 1,
                      },
                    ],
                  })
                }
              >
                + Add a move
              </button>
            }
          >
            {relocations.length === 0 ? (
              <div className="empty">
                No moves planned — the whole run stays in{" "}
                {JURISDICTION_LABELS[startJurisdiction]}.
                <br />A move switches the tax rules, adjusts each spending line
                by how much it tracks local cost of living, and can change your
                pay.
              </div>
            ) : (
              <div className="stack">
                {relocations.map((r, i) => (
                  <RelocationRow
                    key={i}
                    event={r}
                    from={i === 0 ? startJurisdiction : relocations[i - 1].toJurisdiction}
                    onChange={(patch) =>
                      onScenario({
                        relocationEvents: relocations.map((x, k) =>
                          k === i ? { ...x, ...patch } : x,
                        ),
                      })
                    }
                    onRemove={() =>
                      onScenario({
                        relocationEvents: relocations.filter((_, k) => k !== i),
                      })
                    }
                  />
                ))}
              </div>
            )}
          </Card>

          <Card title="Simulation">
            <div className="stack">
              <Segmented
                label="Monte Carlo paths"
                value={paths}
                options={[
                  { value: 200, label: "200" },
                  { value: 500, label: "500" },
                  { value: 1000, label: "1000" },
                ]}
                onChange={onPaths}
                hint="More paths mean steadier percentiles and a slower page."
              />
              <Segmented
                label="Percentile band"
                value={band}
                options={BAND_OPTIONS.map((b) => ({ value: b.key, label: b.label }))}
                onChange={onBand}
                hint="Which range the shaded bands show. The engine computes them all."
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RelocationRow({
  event,
  from,
  onChange,
  onRemove,
}: {
  event: RelocationEvent;
  from: Jurisdiction;
  onChange: (patch: Partial<RelocationEvent>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 11,
        padding: 13,
        background: "var(--s2)",
      }}
    >
      <div className="stack" style={{ gap: 12 }}>
        <Segmented
          label="Move to"
          value={event.toJurisdiction}
          options={(Object.keys(JURISDICTION_SHORT) as Jurisdiction[]).map((j) => ({
            value: j,
            label: JURISDICTION_SHORT[j],
          }))}
          onChange={(j) =>
            onChange({
              toJurisdiction: j,
              expenseLevelMultiplier: Number(
                suggestedExpenseMultiplier(from, j).toFixed(2),
              ),
            })
          }
        />
        <div className="row-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <NumberInput
            label="In year"
            value={event.year}
            onChange={(v) => onChange({ year: v })}
          />
          <NumberInput
            label="Cost of living"
            suffix="×"
            step={0.01}
            value={event.expenseLevelMultiplier ?? 1}
            onChange={(v) => onChange({ expenseLevelMultiplier: v })}
          />
          <NumberInput
            label="Pay"
            suffix="×"
            step={0.01}
            value={event.incomeMultiplier ?? 1}
            onChange={(v) => onChange({ incomeMultiplier: v })}
          />
        </div>
        <button className="btn" onClick={onRemove}>
          Remove move
        </button>
      </div>
    </div>
  );
}
