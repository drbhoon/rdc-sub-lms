import ExcelJS from "exceljs";
import { CLASSROOM_COLUMNS } from "@/lib/classroom-import";
import { autoFit, styleHeader, workbookResponse } from "@/lib/excel-response";
import { currentUser } from "@/lib/session";

export async function GET() {
  if (!await currentUser()) return new Response("Unauthorized", { status: 401 });
  const workbook = new ExcelJS.Workbook();

  // The data sheet must come first: the upload reads the first sheet only.
  const sheet = workbook.addWorksheet("Classrooms");
  sheet.addRow([...CLASSROOM_COLUMNS]);
  styleHeader(sheet.getRow(1));
  sheet.addRow(["Class Room 01", "meena.iyer@rdc.in", "ravi.kumar@rdc.in", "Ravi Kumar", "A00388", "", ""]);
  sheet.addRow(["Class Room 01", "meena.iyer@rdc.in", "sunita.rao@rdc.in", "Sunita Rao", "A00412", "", ""]);
  sheet.addRow(["Class Room 01", "meena.iyer@rdc.in", "priya.sharma@example.com", "Priya Sharma", "", "Intern Batch 2026", "Trainee"]);
  sheet.addRow(["Class Room 02", "arjun.mehta@rdc.in", "vikram.singh@rdc.in", "Vikram Singh", "A00521", "", ""]);
  sheet.addRow(["Class Room 02", "arjun.mehta@rdc.in", "neha.gupta@rdc.in", "Neha Gupta", "A00530", "", ""]);
  sheet.addRow(["Class Room 03", "farah.khan@rdc.in", "", "", "", "", ""]);
  autoFit(sheet);
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const instructions = workbook.addWorksheet("Instructions");
  instructions.addRows([
    ["RDC LMS classroom upload", ""],
    ["Layout", "One row per learner. Repeat the classroom name and its teacher on every row of that classroom. 500 learners in 50 classrooms is 500 rows. Replace the example rows with your own."],
    ["CLASSROOM", "Required. The classroom's name, e.g. Class Room 01. A name that already exists on the course is reused (capitals and extra spaces are ignored), otherwise the classroom is created."],
    ["TEACHER_EMAIL", "The classroom's teacher. It needs to appear on only one row of the classroom, and a classroom can have only one teacher. The teacher must already be an active employee in LMS; if they do not have the Teacher role yet, they are given it. Leave it blank on every row to keep an existing classroom's current teacher."],
    ["LEARNER_EMAIL", "The learner. Someone not yet on the course is enrolled and sent the enrolment e-mail. Someone not in LMS at all is registered as a new learner, exactly as the course roster upload does. A learner can be in only one classroom; one already in another classroom is moved to this one. Leave it blank to create an empty classroom (see Class Room 03)."],
    ["LEARNER_NAME, EMP_CODE, COMPANY, DESIGNATION", "Optional. Used only for a learner who is new to LMS; an existing learner's record is never changed."],
    ["Checking", "The whole file is checked before anything is saved. If there is any problem — a blank classroom, a learner in two classrooms, two teachers for one classroom, an unknown teacher — nothing is changed and every problem is listed."],
    ["Not changed", "Classrooms and learners the file does not mention are left as they are."],
  ]);
  styleHeader(instructions.getRow(1));
  instructions.getColumn(1).width = 30;
  instructions.getColumn(2).width = 110;
  instructions.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  return workbookResponse(workbook, "rdc-lms-classroom-template.xlsx");
}
