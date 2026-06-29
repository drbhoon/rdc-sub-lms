import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import path from "node:path";

export type ImportRow = Record<string, unknown>;

export async function readTabularFile(file: File): Promise<ImportRow[]> {
  if (!file.size) throw new Error("Select a CSV or Excel file.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Upload files must be under 10 MB.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const extension = path.extname(file.name).toLowerCase();
  if (extension === ".csv") {
    return (parse(buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true }) as ImportRow[])
      .filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
  }
  if (extension === ".xlsx" || extension === ".xls") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("Workbook has no worksheets.");
    const headings = (sheet.getRow(1).values as unknown[]).slice(1).map((value) => String(value ?? "").trim());
    const rows: ImportRow[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const record: ImportRow = {};
      headings.forEach((heading, index) => {
        record[heading] = row.getCell(index + 1).text.trim();
      });
      if (Object.values(record).some((value) => String(value ?? "").trim())) rows.push(record);
    });
    return rows;
  }
  throw new Error("Only CSV and Excel files are supported.");
}

export function getField(row: ImportRow, names: string[]) {
  for (const name of names) {
    const key = Object.keys(row).find((candidate) => normalizeHeader(candidate) === normalizeHeader(name));
    const value = key ? row[key] : undefined;
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
