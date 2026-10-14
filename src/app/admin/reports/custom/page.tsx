import { UserRole } from "@prisma/client";
import Link from "next/link";
import { CheckDropdown } from "@/components/check-dropdown";
import { withBase } from "@/lib/base-path";
import {
  COLUMNS, FILTERS, customReportQueryString, loadCustomReport, loadFilterOptions, parseCustomReport, reportCells,
} from "@/lib/custom-report";
import { formatIst } from "@/lib/ist";
import { requireRole } from "@/lib/session";

const PREVIEW_ROWS = 100;
const columnOptions = COLUMNS.map((column) => ({ value: column.key, label: column.label, group: column.group }));

export default async function CustomReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(UserRole.SUPER_ADMIN);
  const params = await searchParams;
  const query = parseCustomReport(params);
  const [options, report] = await Promise.all([loadFilterOptions(), loadCustomReport(query, PREVIEW_ROWS)]);
  const labels = new Map(COLUMNS.map((column) => [column.key, column.label]));
  const download = withBase(`/api/reports/custom?${customReportQueryString(query)}`);
  const filtered = FILTERS.some(({ key }) => query.filters[key].length) || Boolean(query.from || query.to);

  return <main className="container">
    <h1>Reports</h1>
    <nav className="report-tabs" aria-label="Report sections">
      <Link href="/admin/reports">General</Link>
      <Link href="/admin/reports/assessment">Assessment</Link>
      <Link href="/admin/reports/feedback">Feedback</Link>
      <Link className="active" href="/admin/reports/custom">Custom</Link>
      <Link href="/admin/reports/infographic">Infographic</Link>
    </nav>
    <form className="card" method="get">
      <p className="muted">Tick the columns you want, then narrow the learners with any of the filters. A filter with nothing ticked means <strong>any</strong>. One row is one learner on one course.</p>
      <div className="custom-report-form">
        <CheckDropdown name="cols" label="Columns to show" options={columnOptions} selected={query.columns} emptyMeans="Default columns" />
        {FILTERS.map(({ key, label }) => <CheckDropdown key={key} name={`f_${key}`} label={label} options={options[key]} selected={query.filters[key]} />)}
        <label>Enrolled from<input type="date" name="from" defaultValue={query.from} /></label>
        <label>Enrolled to<input type="date" name="to" defaultValue={query.to} /></label>
      </div>
      <div className="custom-report-actions">
        <button>Show report</button>
        <Link className="button secondary" href="/admin/reports/custom">Reset</Link>
        <a className="button secondary" href={download}>Download Excel</a>
      </div>
    </form>

    <section className="card dashboard-row">
      <h2>{report.total} row{report.total === 1 ? "" : "s"}{filtered ? " match these filters" : ""}</h2>
      {report.truncated && <p className="muted">Showing the first {report.rows.length}. The Excel download carries every row.</p>}
      <div className="table-wrap">
        <table>
          <thead><tr>{query.columns.map((key) => <th key={key}>{labels.get(key)}</th>)}</tr></thead>
          <tbody>
            {report.rows.map((row) => <tr key={row.id}>
              {reportCells(row, query.columns).map((cell, index) => <td key={query.columns[index]}>{cell instanceof Date ? formatIst(cell) : cell === null ? "" : String(cell)}</td>)}
            </tr>)}
            {!report.rows.length && <tr><td colSpan={Math.max(query.columns.length, 1)}>No learner matches these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
