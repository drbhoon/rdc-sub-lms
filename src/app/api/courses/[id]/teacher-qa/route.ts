import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { autoFit, styleHeader, workbookResponse } from "@/lib/excel-response";
import { routeCourseManager } from "@/lib/route-auth";
import { teacherQaWhere } from "@/lib/teacher-qa";

/** Every question learners asked their teacher on a course, and the teacher's answers. */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const viewer = await routeCourseManager(id);
  if (!viewer) return new Response("Forbidden", { status: 403 });
  const course = await db.course.findUnique({ where: { id }, select: { title: true } });
  if (!course) return new Response("Not found", { status: 404 });

  const questions = await db.courseQuestion.findMany({
    where: await teacherQaWhere(id, viewer),
    include: {
      employee: { include: { company: true, enrollments: { where: { courseId: id }, include: { classroom: { select: { name: true } } } } } },
      answeredBy: { include: { employee: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50000,
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Q&A with Teacher");
  sheet.addRow(["Course", "Employee Code", "Learner", "Email", "Company", "Classroom", "Question", "Teacher's Answer", "Answered By", "Status", "Asked At", "Answered At"]);
  styleHeader(sheet.getRow(1));
  for (const item of questions) {
    sheet.addRow([
      course.title,
      item.employee.employeeCode,
      item.employee.name,
      item.employee.email,
      item.employee.company.name,
      item.employee.enrollments[0]?.classroom?.name ?? "",
      item.question,
      item.answer ?? "",
      item.answeredBy ? item.answeredBy.employee?.name ?? item.answeredBy.email : "",
      item.answer ? "Answered" : "Waiting for answer",
      item.createdAt,
      item.answeredAt,
    ]);
  }
  sheet.getColumn(11).numFmt = "yyyy-mm-dd hh:mm";
  sheet.getColumn(12).numFmt = "yyyy-mm-dd hh:mm";
  sheet.getColumn(7).alignment = { vertical: "top", wrapText: true };
  sheet.getColumn(8).alignment = { vertical: "top", wrapText: true };
  autoFit(sheet);
  sheet.getColumn(7).width = 52;
  sheet.getColumn(8).width = 60;
  return workbookResponse(workbook, `rdc-teacher-qa-${course.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.xlsx`);
}
