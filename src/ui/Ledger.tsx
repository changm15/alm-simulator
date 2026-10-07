import { useState } from "react";
import { PathResult } from "../engine/types";
import { currencyExact, pct } from "./format";
import { JURISDICTION_LABELS } from "./labels";

/**
 * Year-by-year ledger for one path. Rows where the year forced a sale are
 * tinted, and rows where spending could not be funded at all are flagged —
 * the two failure modes read differently and should look different.
 *
 * On a phone the secondary columns are hidden by default rather than pushed
 * off into a long horizontal scroll; the toggle brings them back.
 */
export function Ledger({ path }: { path: PathResult }) {
  const [showAll, setShowAll] = useState(false);
  const sec = showAll ? "" : "sec";

  return (
    <>
      <button
        className="ledger-toggle"
        onClick={() => setShowAll((v) => !v)}
        aria-pressed={showAll}
      >
        {showAll ? "Show key columns" : "Show all columns"}
      </button>
      <div className="table-wrap" style={{ maxHeight: 460, overflowY: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Year</th>
              <th className={sec}>Age</th>
              <th className={sec}>Where</th>
              <th>Income</th>
              <th>Total tax</th>
              <th>After tax</th>
              <th>Expenses</th>
              <th className={sec}>Income tax</th>
              <th className={sec}>Payroll</th>
              <th className={sec}>Cap gains tax</th>
              <th className={sec}>Free cash</th>
              <th>Contribution</th>
              <th className={sec}>…to 401k/IRA</th>
              <th>Withdrawal</th>
              <th className={sec}>Realized gain</th>
              <th>Return</th>
              <th className={sec}>Taxable</th>
              <th className={sec}>Tax-adv</th>
              <th className={sec}>Cash</th>
              <th>Net worth</th>
            </tr>
          </thead>
          <tbody>
            {path.years.map((y) => (
              <tr
                key={y.year}
                className={
                  y.shortfall
                    ? "shortfall-year"
                    : y.withdrawal > 0
                      ? "withdrawal-year"
                      : undefined
                }
              >
                <td>{y.year}</td>
                <td className={sec}>{y.age ?? "—"}</td>
                <td className={sec}>
                  {JURISDICTION_LABELS[y.jurisdiction].split(",")[0]}
                </td>
                <td>{currencyExact(y.totalIncome)}</td>
                <td>{currencyExact(y.totalTax)}</td>
                <td>{currencyExact(y.totalIncome - y.totalTax)}</td>
                <td>{currencyExact(y.expenses)}</td>
                <td className={sec}>{currencyExact(y.incomeTax)}</td>
                <td className={sec}>{currencyExact(y.payrollTax)}</td>
                <td className={sec}>{currencyExact(y.capitalGainsTax)}</td>
                <td className={sec}>{currencyExact(y.freeCashFlow)}</td>
                <td>
                  {y.contribution ? currencyExact(y.contribution) : "—"}
                </td>
                <td className={sec}>
                  {y.taxAdvantagedContribution
                    ? currencyExact(y.taxAdvantagedContribution)
                    : "—"}
                </td>
                <td>{y.withdrawal ? currencyExact(-y.withdrawal) : "—"}</td>
                <td className={sec}>
                  {y.realizedGains ? currencyExact(y.realizedGains) : "—"}
                </td>
                <td>{pct(y.blendedReturnPct)}</td>
                <td className={sec}>{currencyExact(y.taxableBalance)}</td>
                <td className={sec}>{currencyExact(y.taxAdvantagedBalance)}</td>
                <td className={sec}>{currencyExact(y.cashBuffer)}</td>
                <td>{currencyExact(y.netWorth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
