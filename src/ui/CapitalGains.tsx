import { PathResult, SimulationConfig } from "../engine/types";
import { computeTax } from "../engine/tax";
import { inflationFactor } from "../engine/liabilities";
import { Card, Dot } from "./controls";
import { Chart } from "./charts";
import { useMeasure } from "./useMeasure";
import { currency, currencyExact, pct } from "./format";

/**
 * Unrealized versus realized gains.
 *
 * The distinction is the whole reason this engine tracks cost basis instead of
 * a single balance: growth in a taxable account is untaxed until something
 * forces a sale, and then only the gain portion is taxed. This view makes the
 * embedded liability visible — how much of the account is gain you have not yet
 * paid tax on — alongside the years where a sale actually crystallised some.
 */
export function CapitalGains({
  path,
  config,
}: {
  path: PathResult;
  config: SimulationConfig;
}) {
  const years = path.years;
  const first = years[0];
  const last = years[years.length - 1];

  // What the embedded gain would cost if the whole taxable account were sold
  // this year, on top of this year's ordinary income.
  const embeddedTax = computeTax({
    jurisdiction: first.jurisdiction,
    wages: first.grossWageIncome,
    ordinaryIncome: first.ordinaryTaxableIncome,
    realizedGains: first.unrealizedGain,
    ctx: {
      filingStatus: config.income.filingStatus,
      inflationFactor: inflationFactor(config.liabilities, 0),
    },
  }).capitalGainsTax;

  const gainYears = years.filter((y) => y.realizedGains > 0);
  const effectiveRate =
    path.totalRealizedGains > 0
      ? (path.totalCapitalGainsTax / path.totalRealizedGains) * 100
      : 0;
  const gainFractionNow =
    first.taxableBalance > 0 ? first.unrealizedGain / first.taxableBalance : 0;
  const gainFractionEnd =
    last.taxableBalance > 0 ? last.unrealizedGain / last.taxableBalance : 0;

  return (
    <div>
      <div className="cols" style={{ marginBottom: 16 }}>
        <Card title="Unrealized today">
          <div className="m" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em" }}>
            {currencyExact(first.unrealizedGain)}
          </div>
          <p className="fh">
            {pct(gainFractionNow * 100, 0)} of the taxable account is gain you
            have not been taxed on. Selling all of it this year would cost about{" "}
            <strong>{currencyExact(embeddedTax)}</strong> in capital gains tax.
          </p>
        </Card>
        <Card title="Realized over the plan">
          <div className="m" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em" }}>
            {currencyExact(path.totalRealizedGains)}
          </div>
          <p className="fh">
            Crystallised across {gainYears.length} selling{" "}
            {gainYears.length === 1 ? "year" : "years"}, costing{" "}
            <strong>{currencyExact(path.totalCapitalGainsTax)}</strong> in tax —
            an effective {pct(effectiveRate)} on the gains.
          </p>
        </Card>
      </div>

      <Card
        title="Taxable account: basis and embedded gain"
        style={{ marginBottom: 16 }}
      >
        <div className="legend">
          <span>
            <span className="swatch" style={{ background: "var(--cat-3)" }} />
            Cost basis
          </span>
          <span>
            <span className="swatch" style={{ background: "var(--acc)" }} />
            Balance
          </span>
          <span style={{ color: "var(--tm)" }}>
            Shaded gap = unrealized gain, untaxed until something forces a sale
          </span>
        </div>
        <Chart
          series={[
            {
              label: "Taxable balance",
              color: "var(--acc)",
              fill: "var(--acc-fill)",
              points: years.map((y) => ({ x: y.year, y: y.taxableBalance })),
              band: years.map((y) => ({
                x: y.year,
                lo: y.taxableBasis,
                hi: y.taxableBalance,
              })),
            },
            {
              label: "Cost basis",
              color: "var(--cat-3)",
              dashed: true,
              points: years.map((y) => ({ x: y.year, y: y.taxableBasis })),
            },
          ]}
          aspect={3}
          minHeight={220}
          maxHeight={320}
          xLabel="Year"
          yLabel="Taxable account"
        />
        <p className="fh" style={{ marginTop: 10 }}>
          The gain share drifts from {pct(gainFractionNow * 100, 0)} to{" "}
          {pct(gainFractionEnd * 100, 0)} over the plan. Contributions add basis
          one for one, growth does not — so an account left alone becomes
          steadily more expensive to unwind.
        </p>
      </Card>

      <Card title="Gains realized by year" style={{ marginBottom: 16 }}>
        {gainYears.length === 0 ? (
          <div className="empty">
            No year on this path forced a taxable sale, so nothing was ever
            realized. The embedded gain above stays embedded.
          </div>
        ) : (
          <>
            <RealizedBars path={path} />
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Age</th>
                    <th>Withdrawal</th>
                    <th>Realized gain</th>
                    <th>Gain share</th>
                    <th>Cap gains tax</th>
                    <th>Effective rate</th>
                  </tr>
                </thead>
                <tbody>
                  {gainYears.map((y) => (
                    <tr key={y.year} className="withdrawal-year">
                      <td>{y.year}</td>
                      <td>{y.age ?? "—"}</td>
                      <td>{currencyExact(y.withdrawal)}</td>
                      <td>{currencyExact(y.realizedGains)}</td>
                      <td>
                        {pct(
                          y.withdrawal > 0
                            ? (y.realizedGains / y.withdrawal) * 100
                            : 0,
                          0,
                        )}
                      </td>
                      <td>{currencyExact(y.capitalGainsTax)}</td>
                      <td>
                        {pct(
                          y.realizedGains > 0
                            ? (y.capitalGainsTax / y.realizedGains) * 100
                            : 0,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/**
 * Realized gains are discrete, lumpy, and zero in most years — bars, not a
 * line, which would imply a continuous quantity between the sales.
 */
function RealizedBars({ path }: { path: PathResult }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const years = path.years;
  if (width === 0) return <div ref={ref} style={{ width: "100%", minHeight: 150 }} />;

  const height = 150;
  const PAD = { top: 10, right: 8, bottom: 26, left: 58 };
  const max = Math.max(...years.map((y) => y.realizedGains), 1);
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, years.length);
  const barW = Math.max(2, Math.min(14, slot - 2));
  const tickEvery = Math.max(1, Math.round(years.length / (width < 480 ? 4 : 8)));

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Capital gains realized each year"
        style={{ display: "block" }}
      >
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={PAD.top + plotH - (t / max) * plotH}
              y2={PAD.top + plotH - (t / max) * plotH}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={PAD.top + plotH - (t / max) * plotH}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={10}
              fill="var(--tm)"
              fontFamily="var(--mono)"
            >
              {currency(t)}
            </text>
          </g>
        ))}

        {years.map((y, i) => {
          if (y.realizedGains <= 0) return null;
          const h = (y.realizedGains / max) * plotH;
          return (
            <rect
              key={y.year}
              x={PAD.left + i * slot + (slot - barW) / 2}
              y={PAD.top + plotH - h}
              width={barW}
              height={Math.max(1, h)}
              rx={Math.min(3, barW / 2)}
              fill="var(--cat-2)"
            >
              <title>
                {`${y.year}: ${currencyExact(y.realizedGains)} realized, ${currencyExact(y.capitalGainsTax)} tax`}
              </title>
            </rect>
          );
        })}

        {years.map((y, i) =>
          i % tickEvery === 0 ? (
            <text
              key={y.year}
              x={PAD.left + i * slot + slot / 2}
              y={height - PAD.bottom + 15}
              textAnchor="middle"
              fontSize={10}
              fill="var(--tm)"
              fontFamily="var(--mono)"
            >
              {y.year}
            </text>
          ) : null,
        )}
      </svg>
      <div className="legend" style={{ marginTop: 8, marginBottom: 0 }}>
        <span>
          <Dot color="var(--cat-2)" /> Gain realized that year
        </span>
      </div>
    </div>
  );
}
