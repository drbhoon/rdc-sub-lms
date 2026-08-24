import ExcelJS from "exceljs";
import { styleHeader, autoFit, workbookResponse } from "@/lib/excel-response";
import { currentUser } from "@/lib/session";

export async function GET() {
  if (!await currentUser()) return new Response("Unauthorized", { status: 401 });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Course Roster");
  sheet.addRow(["EMAIL", "NAME", "EMP_CODE", "COMPANY", "DESIGNATION"]);
  styleHeader(sheet.getRow(1));
  sheet.addRow(["ravi.kumar@rdc.in", "Ravi Kumar", "A00388", "", ""]);
  sheet.addRow(["priya.sharma@example.com", "Priya Sharma", "", "Intern Batch 2026", "Trainee"]);
  autoFit(sheet);
  const instructions = workbook.addWorksheet("Instructions");
  instructions.addRows([
    ["RDC LMS course roster"],
    ["Requirement", "EMAIL is the only column that must be filled for every row."],
    ["Existing learner", "Matched by e-mail. NAME, EMP_CODE, COMPANY and DESIGNATION are ignored — the learner's record on file is used, and enrolling does not change it."],
    ["New learner", "An e-mail not already in the system is registered as a new learner and enrolled — this is how to bring in interns and other candidates who are not on the employee master. NAME, COMPANY and DESIGNATION may be left blank; sensible defaults are used (name from the e-mail address, company \"Interns\", designation \"Intern\")."],
    ["Employee code", "Only needed if you want a specific one. Left blank for a new learner, one is generated automatically."],
  ]);
  styleHeader(instructions.getRow(1));
  autoFit(instructions);
  return workbookResponse(workbook, "rdc-lms-course-roster-template.xlsx");
}
