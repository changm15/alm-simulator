/**
 * Small SVG chart toolkit.
 *
 * Deliberately no dual-axis charts: where two measures of different scale need
 * to be compared (median outcome vs. drawdown), they are drawn as separate
 * panels sharing an x-axis rather than sharing a plot with two y-scales.
 */

import { useState } from "react";
import { currency, pct } from "./format";
import { useMeasure } from "./useMeasure";

/** Narrower gutters and fewer ticks once the chart is phone-width. */
function padding(width: number) {
  const compact = width < 420;
  return {
    top: 14,
    right: compact ? 10 : 16,
    bottom: 34,
    left: compact ? 44 : 58,
  };
}

interface Scale {
  (v: number): number;
}

function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(v);
  return ticks;
}

interface Point {
  x: number;
  y: number;
}

export interface Series {
  label: string;
  color: string;
  fill?: string;
  points: Point[];
  /** Optional p10/p90 band drawn behind the line. */
  band?: { x: number; lo: number; hi: number }[];
  dashed?: boolean;
}

export interface ChartProps {
  series: Series[];
  /** Aspect ratio used to derive height from the measured width. */
  aspect?: number;
  minHeight?: number;
  maxHeight?: number;
  xLabel: string;
  yLabel: string;
  yFormat?: (n: number) => string;
  xFormat?: (n: number) => string;
  /** Force the y domain to include zero. */
  zeroBaseline?: boolean;
  /** Shared y domain across facets, so panels are visually comparable. */
  yDomain?: [number, number];
  markers?: boolean;
}

export function Chart({
  series,
  aspect = 2,
  minHeight = 180,
  maxHeight = 320,
  xLabel,
  yLabel,
  yFormat = currency,
  xFormat = (n) => String(n),
  zeroBaseline = true,
  yDomain,
  markers = false,
}: ChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, measured] = useMeasure<HTMLDivElement>();

  // Render nothing until the container has been measured, so the chart is
  // never laid out against a guessed width.
  const width = measured || 0;
  const height = Math.max(minHeight, Math.min(maxHeight, width / aspect));
  const PAD = padding(width);
  const compact = width < 420;

  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const allY = series.flatMap((s) => [
    ...s.points.map((p) => p.y),
    ...(s.band ?? []).flatMap((b) => [b.lo, b.hi]),
  ]);
  const empty = allX.length === 0 || allY.length === 0;
  if (empty || width === 0) {
    return <div ref={ref} style={{ width: "100%", minHeight }} />;
  }

  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  const yMinRaw = yDomain ? yDomain[0] : Math.min(...allY);
  const yMaxRaw = yDomain ? yDomain[1] : Math.max(...allY);
  const yMin = yDomain ? yMinRaw : zeroBaseline ? Math.min(0, yMinRaw) : yMinRaw;
  const yMax = yMaxRaw === yMin ? yMin + 1 : yMaxRaw;

  const x = linear([xMin, xMax], [PAD.left, width - PAD.right]);
  const y = linear([yMin, yMax], [height - PAD.bottom, PAD.top]);

  const yTicks = niceTicks(yMin, yMax, compact ? 3 : 4);
  const xTicks = niceTicks(
    xMin,
    xMax,
    Math.min(compact ? 4 : 6, new Set(allX).size),
  );

  const xs = [...new Set(allX)].sort((a, b) => a - b);
  const hoveredX = hover !== null ? xs[hover] : null;

  function locate(clientX: number, rect: DOMRect) {
    const px = ((clientX - rect.left) / rect.width) * width;
    let best = 0;
    let bestD = Infinity;
    xs.forEach((v, i) => {
      const d = Math.abs(x(v) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  }

  const onMove = (e: React.MouseEvent<SVGRectElement>) =>
    locate(e.clientX, e.currentTarget.getBoundingClientRect());

  const onTouch = (e: React.TouchEvent<SVGRectElement>) =>
    locate(e.touches[0].clientX, e.currentTarget.getBoundingClientRect());

  const line = (pts: Point[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.x)},${y(p.y)}`).join(" ");

  const area = (band: NonNullable<Series["band"]>) =>
    [
      ...band.map((b, i) => `${i === 0 ? "M" : "L"}${x(b.x)},${y(b.hi)}`),
      ...[...band].reverse().map((b) => `L${x(b.x)},${y(b.lo)}`),
      "Z",
    ].join(" ");

  return (
    <div ref={ref} style={{ width: "100%" }}>
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={`${yLabel} by ${xLabel}`}
      style={{ display: "block", overflow: "visible" }}
    >
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--grid)"
            strokeWidth={1}
          />
          <text
            x={PAD.left - 8}
            y={y(t)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={10}
            fill="var(--text-muted)"
            fontFamily="var(--mono)"
          >
            {yFormat(t)}
          </text>
        </g>
      ))}

      {xTicks.map((t) => (
        <text
          key={`x${t}`}
          x={x(t)}
          y={height - PAD.bottom + 16}
          textAnchor="middle"
          fontSize={10}
          fill="var(--text-muted)"
          fontFamily="var(--mono)"
        >
          {xFormat(t)}
        </text>
      ))}

      <text
        x={(PAD.left + width - PAD.right) / 2}
        y={height - 2}
        textAnchor="middle"
        fontSize={10}
        fill="var(--text-muted)"
      >
        {xLabel}
      </text>

      {series.map((s) =>
        s.band ? (
          <path
            key={`band-${s.label}`}
            d={area(s.band)}
            fill={s.fill ?? s.color}
            opacity={0.28}
          />
        ) : null,
      )}

      {series.map((s) => (
        <path
          key={`line-${s.label}`}
          d={line(s.points)}
          fill="none"
          stroke={s.color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={s.dashed ? "4 3" : undefined}
        />
      ))}

      {markers &&
        series.flatMap((s) =>
          s.points.map((p) => (
            <circle
              key={`m-${s.label}-${p.x}`}
              cx={x(p.x)}
              cy={y(p.y)}
              r={compact ? 3 : 4}
              fill={s.color}
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          )),
        )}

      {hoveredX !== null && (
        <g>
          <line
            x1={x(hoveredX)}
            x2={x(hoveredX)}
            y1={PAD.top}
            y2={height - PAD.bottom}
            stroke="var(--text-muted)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          {series.map((s) => {
            const p = s.points.find((q) => q.x === hoveredX);
            if (!p) return null;
            return (
              <circle
                key={`h-${s.label}`}
                cx={x(p.x)}
                cy={y(p.y)}
                r={5}
                fill={s.color}
                stroke="var(--surface-1)"
                strokeWidth={2}
              />
            );
          })}
        </g>
      )}

      <rect
        x={PAD.left}
        y={PAD.top}
        width={width - PAD.left - PAD.right}
        height={height - PAD.top - PAD.bottom}
        fill="transparent"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onTouchStart={onTouch}
        onTouchMove={onTouch}
        onTouchEnd={() => setHover(null)}
        style={{ touchAction: "pan-y" }}
      />

      {hoveredX !== null && (
        <foreignObject
          x={Math.min(x(hoveredX) + 8, width - 150)}
          y={PAD.top}
          width={150}
          height={90}
          pointerEvents="none"
        >
          <div
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "5px 7px",
              fontSize: 11,
              fontFamily: "var(--mono)",
              color: "var(--text-primary)",
              lineHeight: 1.5,
            }}
          >
            <div style={{ color: "var(--text-muted)" }}>
              {xFormat(hoveredX)}
            </div>
            {series.map((s) => {
              const p = s.points.find((q) => q.x === hoveredX);
              if (!p) return null;
              return (
                <div key={s.label}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: s.color,
                      marginRight: 5,
                    }}
                  />
                  {yFormat(p.y)}
                </div>
              );
            })}
          </div>
        </foreignObject>
      )}
    </svg>
    </div>
  );
}

export const percentAxis = (n: number) => pct(n, 0);
