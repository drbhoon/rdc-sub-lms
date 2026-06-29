import ExcelJS from "exceljs";
import { styleHeader, autoFit, workbookResponse } from "@/lib/excel-response";
import { currentUser } from "@/lib/session";

export async function GET() {
  if (!await currentUser()) return new Response("Unauthorized", { status: 401 });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Feedback Template");
  sheet.addRow(["ORDER", "QUESTION", "TYPE", "REQUIRED", "OPTIONS"]);
  styleHeader(sheet.getRow(1));
  sheet.addRow([1, "Rate the usefulness of this course", "RATING_1_5", "YES", ""]);
  sheet.addRow([2, "Was the course easy to understand?", "YES_NO", "YES", ""]);
  sheet.addRow([3, "What should be improved?", "LONG_TEXT", "NO", ""]);
  sheet.addRow([4, "Overall feedback", "SINGLE_CHOICE", "YES", "Excellent|Good|Average|Poor"]);
  autoFit(sheet);
  return workbookResponse(workbook, "rdc-course-feedback-template.xlsx");
}
