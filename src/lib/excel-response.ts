import ExcelJS from "exceljs";

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

export async function workbookResponse(workbook: ExcelJS.Workbook, filename: string) {
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
