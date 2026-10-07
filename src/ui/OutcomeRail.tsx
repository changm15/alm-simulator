import { PathResult } from "../engine/types";
import { MonteCarloResult, bandFor, BandKey } from "../engine/simulate";
import { currency, pct } from "./format";

/**
 * The consequence of every edit, always on screen.
 *
 * Two clocks run here. The headline and sparkline come from a single
 * DETERMINISTIC run of the real engine — one path over the horizon, cheap
 * enough to recompute on every keystroke, and honest because it is the same
 * cash-flow loop with the same taxes and cost-basis tracking. The distribution
 * figures come from the full Monte Carlo, which is deferred so dragging a
 * slider never waits on 500 paths; while it catches up the block dims rather
 * than showing numbers that do not match the controls.
 */
export function OutcomeRail({
  live,
  mc,
  mcStale,
  band,
  endAge,
  startYear,
}: {
  live: PathResult;
  mc: MonteCarloResult;
  mcStale: boolean;
  band: BandKey;
  endAge?: number;
  startYear: number;
}) {
  const spec = bandFor(band);
  const failed = live.firstShortfallYearIndex !== null;
  const color = failed ? "var(--crit)" : "var(--acc)";

  const values = live.years.map((y) => y.netWorth);
  const peak = Math.max(...values, 0);
  const spark = sparkPath(values, 280, 74);

  const retireIdx = live.years.findIndex((y) => y.withdrawal > 0);
  const retireX =
    retireIdx > 0 ? (retireIdx / Math.max(1, values.length - 1)) * 280 : null;

  const failYear =
    live.firstShortfallYearIndex !== null
      ? startYear + live.firstShortfallYearIndex
      : null;
  const failAge = live.years.find((y) => y.shortfall)?.age;

  return (
    <div className="out">
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        {endAge ? `Projected at age ${endAge}` : "Projected at plan end"}
      </div>
      <div className="hero" style={{ color }}>
        {currency(live.terminalNetWorth)}
      </div>
      <p className="fh" style={{ marginBottom: 12 }}>
        {failed
          ? `Spending outruns the portfolio in ${failYear}${failAge ? `, at age ${failAge}` : ""}.`
          : "Funded through the whole plan on the median return path."}
      </p>

      <svg
        viewBox="0 0 280 74"
        width="100%"
        height="74"
        style={{ display: "block", marginBottom: 14 }}
        role="img"
        aria-label="Projected net worth over the plan"
      >
        <defs>
          <linearGradient id="railFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={spark.area} fill="url(#railFade)" />
        <path
          d={spark.line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {retireX !== null && (
          <line
            x1={retireX}
            y1={0}
            x2={retireX}
            y2={74}
            stroke="var(--bd2)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
      </svg>

      <Metric k="Peak balance" v={currency(peak)} />
      <Metric
        k="Runs out"
        v={failed ? `${failYear}` : "Never"}
        color={failed ? "var(--crit)" : "var(--good)"}
      />
      <Metric k="Portfolio return" v={pct(live.annualizedReturnPct)} />
      <Metric k="You contribute" v={currency(live.totalContributions)} />
      <Metric k="Market adds" v={currency(live.totalInvestmentGain)} />
      <Metric k="Lifetime tax" v={currency(live.totalTaxPaid)} />

      <div
        style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px solid var(--bd)",
          opacity: mcStale ? 0.45 : 1,
          transition: "opacity 0.2s ease",
        }}
      >
        <div
          className="eyebrow"
          style={{ display: "flex", justifyContent: "space-between", gap: 10 }}
        >
          <span>Across {mc.paths.length} paths</span>
          {mcStale ? <span style={{ color: "var(--tm)" }}>updating…</span> : null}
        </div>
        <div style={{ marginTop: 6 }}>
          <Metric
            k={`Terminal, ${spec.label}`}
            v={`${currency(mc.terminalNetWorth[spec.lo] as number)} – ${currency(
              mc.terminalNetWorth[spec.hi] as number,
            )}`}
          />
          <Metric
            k="Shortfall probability"
            v={pct(mc.shortfallProbability * 100)}
            color={
              mc.shortfallProbability > 0.15
                ? "var(--crit)"
                : mc.shortfallProbability > 0
                  ? "var(--warn)"
                  : "var(--good)"
            }
          />
          <Metric k="Median max drawdown" v={pct(mc.maxDrawdownPct.median)} />
        </div>
      </div>

      <p className="fh rail-foot" style={{ marginTop: 14 }}>
        The headline is one run of the full engine with the volatility draw
        switched off and corrected for drag, so it tracks the median rather
        than the mean. Same taxes, same cost-basis tracking, same forced sales.
      </p>
    </div>
  );
}

function Metric({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="metric">
      <span className="metric-k">{k}</span>
      <span className="metric-v" style={color ? { color } : undefined}>
        {v}
      </span>
    </div>
  );
}

function sparkPath(values: number[], w: number, h: number) {
  if (values.length === 0) return { line: "", area: "" };
  const max = Math.max(...values, 1);
  const n = Math.max(1, values.length - 1);
  let line = "";
  values.forEach((v, i) => {
    const x = (i / n) * w;
    const y = h - (Math.max(0, v) / max) * (h - 4) - 2;
    line += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return { line, area: `${line}L${w},${h}L0,${h}Z` };
}
