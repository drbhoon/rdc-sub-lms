import ExcelJS from "exceljs";
import { styleHeader, autoFit, workbookResponse } from "@/lib/excel-response";
import { currentUser } from "@/lib/session";

export async function GET() {
  if (!await currentUser()) return new Response("Unauthorized", { status: 401 });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("MCQ Assessment Template");
  sheet.addRow(["Sr. No.", "Question", "Option A", "Option B", "Option C", "Option D", "Answer Option"]);
  styleHeader(sheet.getRow(1));
  sheet.addRow([1, "5+8=", "13", "12", "11", "10", "A"]);
  sheet.addRow([2, "Which PPE is mandatory at site?", "Helmet", "Sports cap", "Slippers", "None", "A"]);
  sheet.getColumn(1).numFmt = "0";
  autoFit(sheet);
  return workbookResponse(workbook, "rdc-mcq-assessment-template.xlsx");
}
