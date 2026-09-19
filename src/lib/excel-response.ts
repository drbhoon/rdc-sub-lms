import ExcelJS from "exceljs";
import { toExcelIst } from "./ist";

export function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF12233F" } };
  row.alignment = { vertical: "middle" };
}

export function autoFit(worksheet: ExcelJS.Worksheet) {
  worksheet.columns.forEach((column) => {
    let max = 12;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      max = Math.max(max, Math.min(48, String(cell.value ?? "").length + 2));
    });
    column.width = max;
  });
}

/**
 * Show every date in the workbook in IST.
 *
 * Done once, here, rather than in each export: every download goes through
 * workbookResponse, so no export can forget it and none can do it twice. A
 * date cell with no format of its own gets a readable date-and-time one —
 * ExcelJS otherwise falls back to a date-only US format.
 */
export function datesToIst(workbook: ExcelJS.Workbook) {
  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (!(cell.value instanceof Date)) return;
        cell.value = toExcelIst(cell.value);
        if (!cell.numFmt || cell.numFmt === "General") cell.numFmt = "dd-mmm-yyyy hh:mm";
      });
    });
  });
}

export async function workbookResponse(workbook: ExcelJS.Workbook, filename: string) {
  datesToIst(workbook);
  workbook.creator = "RDC LMS";
  workbook.created = new Date();
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
