import { SweepResult, AllocationPoint } from "../engine/sensitivity";
import { BandKey, bandFor } from "../engine/simulate";
import { Chart, Series } from "./charts";
import { currency, pct } from "./format";

const COLORS = ["var(--series-1)", "var(--series-2)"];
const FILLS = ["var(--series-1-fill)", "var(--series-2-fill)"];

/**
 * The allocation sweep, drawn as small multiples.
 *
 * Three measures live on three different scales (dollars, drawdown %,
 * shortfall %), so they get three panels sharing one x-axis rather than one
 * plot with stacked y-axes. Each row uses a shared y-domain across scenarios
 * so the two columns are directly comparable by eye.
 */
export function SensitivityPanels({
  sweeps,
  band,
}: {
  sweeps: SweepResult[];
  band: BandKey;
}) {
  if (sweeps.length === 0) return null;

  const spec = bandFor(band);
  const lo = (p: AllocationPoint) =>
    spec.lo === "p25" ? p.p25Terminal : p.p10Terminal;
  const hi = (p: AllocationPoint) =>
    spec.hi === "median"
      ? p.medianTerminal
      : spec.hi === "p75"
        ? p.p75Terminal
        : p.p90Terminal;

  const sharedDomain = (
    pick: (p: SweepResult["points"][number]) => number[],
  ): [number, number] => {
    const vals = sweeps.flatMap((s) => s.points.flatMap(pick));
    // A little headroom so the top of a percentile band is not clipped by the
    // plot edge.
    return [Math.min(0, ...vals), Math.max(...vals) * 1.06];
  };

  const terminalDomain = sharedDomain((p) => [lo(p), hi(p), p.medianTerminal]);
  const drawdownDomain = sharedDomain((p) => [p.medianMaxDrawdownPct]);
  const shortfallDomain = sharedDomain((p) => [p.shortfallProbability * 100]);

  const xLabel = `${labelFor(sweeps[0].sweptClass)} allocation (%)`;

  return (
    <div>
      <div className="legend">
        {sweeps.map((s, i) => (
          <span key={s.scenarioLabel}>
            <span className="swatch" style={{ background: COLORS[i % 2] }} />
            {s.scenarioLabel}
          </span>
        ))}
        <span style={{ color: "var(--text-muted)" }}>
          Shaded band = {spec.label} percentile of terminal outcomes
        </span>
      </div>

      <Row
        title="Terminal net worth"
        sub={`Median line, ${spec.label} percentile band. More Treasuries narrows the band.`}
        sweeps={sweeps}
        xLabel={xLabel}
        yLabel="Terminal net worth"
        yDomain={terminalDomain}
        yFormat={currency}
        build={(s, i) => ({
          label: s.scenarioLabel,
          color: COLORS[i % 2],
          fill: FILLS[i % 2],
          points: s.points.map((p) => ({
            x: p.sweptWeightPct,
            y: p.medianTerminal,
          })),
          band: s.points.map((p) => ({
            x: p.sweptWeightPct,
            lo: lo(p),
            hi: hi(p),
          })),
        })}
      />

      <Row
        title="Median max peak-to-trough drawdown"
        sub="The deepest fall from a prior high during the horizon."
        sweeps={sweeps}
        xLabel={xLabel}
        yLabel="Max drawdown (%)"
        yDomain={drawdownDomain}
        yFormat={(n) => pct(n, 0)}
        build={(s, i) => ({
          label: s.scenarioLabel,
          color: COLORS[i % 2],
          points: s.points.map((p) => ({
            x: p.sweptWeightPct,
            y: p.medianMaxDrawdownPct,
          })),
        })}
      />

      <Row
        title="Shortfall probability"
        sub="Share of paths where spending could not be funded in some year before the horizon ends."
        sweeps={sweeps}
        xLabel={xLabel}
        yLabel="Shortfall probability (%)"
        yDomain={shortfallDomain}
        yFormat={(n) => pct(n, 0)}
        build={(s, i) => ({
          label: s.scenarioLabel,
          color: COLORS[i % 2],
          points: s.points.map((p) => ({
            x: p.sweptWeightPct,
            y: p.shortfallProbability * 100,
          })),
        })}
      />

      <SweepTable sweeps={sweeps} />
    </div>
  );
}

function Row({
  title,
  sub,
  sweeps,
  build,
  ...chart
}: {
  title: string;
  sub: string;
  sweeps: SweepResult[];
  build: (s: SweepResult, i: number) => Series;
  xLabel: string;
  yLabel: string;
  yDomain: [number, number];
  yFormat: (n: number) => string;
}) {
  return (
    <div style={{ marginBottom: 26 }}>
      <h3 className="facet-title">{title}</h3>
      <p className="facet-sub">{sub}</p>
      <div className="small-multiples">
        {sweeps.map((s, i) => (
          <figure key={s.scenarioLabel} style={{ margin: 0 }}>
            <figcaption
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                marginBottom: 4,
              }}
            >
              <span className="swatch" style={{ background: COLORS[i % 2] }} />
              {s.scenarioLabel}
            </figcaption>
            <Chart
              {...chart}
              series={[build(s, i)]}
              markers
              aspect={1.9}
              minHeight={190}
              maxHeight={260}
              xFormat={(n) => `${n}%`}
            />
          </figure>
        ))}
      </div>
    </div>
  );
}

/** Table view — the same numbers, readable without relying on color. */
function SweepTable({ sweeps }: { sweeps: SweepResult[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>{labelFor(sweeps[0].sweptClass)} %</th>
            <th>Median terminal</th>
            <th>10th pct</th>
            <th>90th pct</th>
            <th>Spread</th>
            <th>Median max DD</th>
            <th>Shortfall prob.</th>
          </tr>
        </thead>
        <tbody>
          {sweeps.flatMap((s) =>
            s.points.map((p) => (
              <tr key={`${s.scenarioLabel}-${p.sweptWeightPct}`}>
                <td>{s.scenarioLabel}</td>
                <td>{p.sweptWeightPct}%</td>
                <td>{currency(p.medianTerminal)}</td>
                <td>{currency(p.p10Terminal)}</td>
                <td>{currency(p.p90Terminal)}</td>
                <td>{currency(p.spread)}</td>
                <td>{pct(p.medianMaxDrawdownPct)}</td>
                <td>{pct(p.shortfallProbability * 100)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function labelFor(cls: string): string {
  return (
    {
      usEquity: "US equity",
      intlEquity: "Intl equity",
      usTreasuries: "US Treasuries",
      corporateBonds: "Corporate bonds",
      cash: "Cash",
    }[cls] ?? cls
  );
}
