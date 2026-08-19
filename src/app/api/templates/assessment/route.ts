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
  const instructions = workbook.addWorksheet("Instructions");
  instructions.addRows([
    ["RDC MCQ question bank"],
    ["Requirement", "Enter between 50 and 200 complete questions in the first sheet."],
    ["Answer Option", "Use A, B, C or D only."],
    ["Quiz offer", "The administrator separately chooses how many random questions each learner receives."],
    ["Timer", "The overall quiz timer is configured in the portal; no individual question timer is needed."],
  ]);
  styleHeader(instructions.getRow(1));
  autoFit(instructions);
  return workbookResponse(workbook, "rdc-mcq-assessment-template.xlsx");
}
