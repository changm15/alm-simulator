import { useState } from "react";
import { YearResult } from "../engine/types";
import { useMeasure } from "./useMeasure";
import { currency, currencyExact } from "./format";

/** Round a max up to a clean 1/2/5 x 10^n value so the axis reads sensibly. */
function niceCeiling(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

const CAT_COLORS = [
  "var(--cat-1)",
  "var(--cat-2)",
  "var(--cat-3)",
  "var(--cat-4)",
  "var(--cat-5)",
  "var(--cat-6)",
  "var(--cat-7)",
  "var(--cat-8)",
];

/**
 * Spending plan over the horizon, stacked by category.
 *
 * Categories past the eighth fold into "Other" rather than getting a generated
 * hue. A table view ships alongside because three of the categorical slots sit
 * below 3:1 contrast on a light surface — identity must never be colour alone.
 */
export function ExpenseBreakdown({
  years,
  oneTimeLabels = [],
}: {
  years: YearResult[];
  /** Labels that are lumpy one-off events rather than ongoing plan lines. */
  oneTimeLabels?: string[];
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [showTable, setShowTable] = useState(false);
  // One-time events are excluded by default: a single house down payment is
  // several times the annual plan and flattens everything else into a strip.
  const [includeOneTime, setIncludeOneTime] = useState(false);

  // A stable category order taken from the first year, so a series does not
  // change colour when a one-time event appears mid-horizon.
  const isOneTime = (label: string) => oneTimeLabels.includes(label);
  const visible = (label: string) => includeOneTime || !isOneTime(label);

  const ordered: string[] = [];
  for (const y of years) {
    for (const item of y.expenseBreakdown) {
      if (visible(item.label) && !ordered.includes(item.label)) {
        ordered.push(item.label);
      }
    }
  }
  const shown = ordered.slice(0, 7);
  const foldsOther = ordered.length > 7;
  const labels = foldsOther ? [...shown, "Other"] : shown;

  const amountFor = (y: YearResult, label: string): number => {
    if (label === "Other") {
      return y.expenseBreakdown
        .filter((i) => visible(i.label) && !shown.includes(i.label))
        .reduce((a, i) => a + i.amount, 0);
    }
    return y.expenseBreakdown
      .filter((i) => i.label === label)
      .reduce((a, i) => a + i.amount, 0);
  };

  const compact = width < 480;
  const height = Math.max(200, Math.min(300, width / 2.6));
  const PAD = { top: 12, right: 12, bottom: 32, left: compact ? 46 : 60 };

  if (width === 0 || years.length === 0) {
    return <div ref={ref} style={{ width: "100%", minHeight: 220 }} />;
  }

  const yearTotal = (y: YearResult) =>
    labels.reduce((a, label) => a + amountFor(y, label), 0);
  const maxTotal = niceCeiling(Math.max(...years.map(yearTotal)));
  const x = (i: number) =>
    PAD.left +
    (i / Math.max(1, years.length - 1)) * (width - PAD.left - PAD.right);
  const yScale = (v: number) =>
    height - PAD.bottom - (v / (maxTotal || 1)) * (height - PAD.top - PAD.bottom);

  // Running cumulative tops, one array per stacked band.
  const cumulative = years.map(() => 0);
  const bands = labels.map((label) => {
    const lower = [...cumulative];
    years.forEach((y, i) => {
      cumulative[i] += amountFor(y, label);
    });
    const upper = [...cumulative];
    return { label, lower, upper };
  });

  const path = (band: { lower: number[]; upper: number[] }) =>
    [
      ...band.upper.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${yScale(v)}`),
      ...[...band.lower]
        .map((v, i) => ({ v, i }))
        .reverse()
        .map(({ v, i }) => `L${x(i)},${yScale(v)}`),
      "Z",
    ].join(" ");

  const yTicks = [0, maxTotal / 2, maxTotal];
  const totalFor = yearTotal;
  const tickEvery = Math.max(1, Math.round(years.length / (compact ? 4 : 7)));

  return (
    <div>
      <div className="legend">
        {labels.map((label, i) => (
          <span key={label}>
            <span
              className="swatch"
              style={{ background: CAT_COLORS[i % CAT_COLORS.length] }}
            />
            {label}
          </span>
        ))}
      </div>

      <div ref={ref} style={{ width: "100%" }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          role="img"
          aria-label="Annual expenses by category over the horizon"
          style={{ display: "block" }}
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={yScale(t)}
                y2={yScale(t)}
                stroke="var(--grid)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={yScale(t)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fill="var(--text-muted)"
                fontFamily="var(--mono)"
              >
                {currency(t)}
              </text>
            </g>
          ))}

          {bands.map((band, i) => (
            <path
              key={band.label}
              d={path(band)}
              fill={CAT_COLORS[i % CAT_COLORS.length]}
              // A surface-coloured hairline keeps adjacent fills separated
              // rather than reading as one blob.
              stroke="var(--surface-1)"
              strokeWidth={1.5}
            />
          ))}

          {years.map((y, i) =>
            i % tickEvery === 0 ? (
              <text
                key={y.year}
                x={x(i)}
                y={height - PAD.bottom + 15}
                textAnchor="middle"
                fontSize={10}
                fill="var(--text-muted)"
                fontFamily="var(--mono)"
              >
                {y.year}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      <div className="chart-actions">
        <button onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? "Hide table" : "Show table"}
        </button>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={includeOneTime}
            onChange={(e) => setIncludeOneTime(e.target.checked)}
          />
          Include one-time events
        </label>
        {!includeOneTime && oneTimeLabels.length > 0 && (
          <span className="chart-note">
            Excluding {oneTimeLabels.join(", ")} — they dwarf the annual plan.
          </span>
        )}
      </div>

      {showTable && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                {years
                  .filter((_, i) => i % tickEvery === 0)
                  .map((y) => (
                    <th key={y.year}>{y.year}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((label) => (
                <tr key={label}>
                  <td>{label}</td>
                  {years
                    .filter((_, i) => i % tickEvery === 0)
                    .map((y) => (
                      <td key={y.year}>
                        {amountFor(y, label)
                          ? currencyExact(amountFor(y, label))
                          : "—"}
                      </td>
                    ))}
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                {years
                  .filter((_, i) => i % tickEvery === 0)
                  .map((y) => (
                    <td key={y.year}>
                      <strong>{currencyExact(totalFor(y))}</strong>
                    </td>
                  ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
