import ExcelJS from "exceljs";
import { UserRole } from "@prisma/client";
import { autoFit, styleHeader, workbookResponse } from "@/lib/excel-response";
import { COLUMNS, FILTERS, MAX_REPORT_ROWS, loadCustomReport, loadFilterOptions, parseCustomReport, reportCells } from "@/lib/custom-report";
import { routeUserWithRole } from "@/lib/route-auth";

export async function GET(request: Request) {
  if (!await routeUserWithRole(UserRole.SUPER_ADMIN)) return new Response("Forbidden", { status: 403 });
  const query = parseCustomReport(new URL(request.url).searchParams);
  const [report, options] = await Promise.all([loadCustomReport(query), loadFilterOptions()]);
  const labels = new Map(COLUMNS.map((column) => [column.key, column.label]));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Custom report");
  sheet.addRow(query.columns.map((key) => labels.get(key) ?? key));
  styleHeader(sheet.getRow(1));
  for (const row of report.rows) sheet.addRow(reportCells(row, query.columns));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  autoFit(sheet);

  // What the report was narrowed by, so the file explains itself when forwarded.
  const about = workbook.addWorksheet("Filters used");
  about.addRow(["Filter", "Chosen"]);
  styleHeader(about.getRow(1));
  for (const { key, label } of FILTERS) {
    const chosen = query.filters[key].map((value) => options[key].find((option) => option.value === value)?.label ?? value);
    about.addRow([label, chosen.length ? chosen.join(", ") : "Any"]);
  }
  about.addRow(["Enrolled from", query.from || "Any"]);
  about.addRow(["Enrolled to", query.to || "Any"]);
  about.addRow(["Rows", report.total]);
  if (report.truncated) about.addRow(["Note", `Only the first ${MAX_REPORT_ROWS} of ${report.total} rows are included. Narrow the filters to see the rest.`]);
  autoFit(about);

  return workbookResponse(workbook, "rdc-lms-custom-report.xlsx");
}
