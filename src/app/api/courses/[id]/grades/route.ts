import ExcelJS from "exceljs";
import { classroomScope, enrollmentScopeWhere } from "@/lib/classroom-scope";
import { loadCourseGrades } from "@/lib/course-grades";
import { db } from "@/lib/db";
import { autoFit, styleHeader, workbookResponse } from "@/lib/excel-response";
import { routeCourseManager } from "@/lib/route-auth";

/**
 * Every learner's weighted course result, one row each: each component's score
 * and weight, the total out of 100, and the teacher's comments. Classroom rules
 * apply as on the teacher's page — a teacher running classrooms gets only theirs.
 */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const viewer = await routeCourseManager(id);
  if (!viewer) return new Response("Forbidden", { status: 403 });
  const course = await db.course.findUnique({ where: { id }, select: { title: true } });
  if (!course) return new Response("Not found", { status: 404 });

  const owned = await db.classroom.findMany({ where: { courseId: id, teacherUserId: viewer.id }, select: { id: true } });
  const scope = classroomScope({ roles: viewer.roles.map((grant) => grant.role), ownedClassroomIds: owned.map((room) => room.id) });
  const enrollments = await db.enrollment.findMany({
    where: { courseId: id, ...enrollmentScopeWhere(scope) },
    include: { employee: { include: { company: true } }, classroom: { select: { name: true } } },
    orderBy: { employee: { name: "asc" } },
  });
  const grades = await loadCourseGrades(id, enrollments.map((enrollment) => enrollment.employeeId));
  if (!grades) return new Response("This course has no assessment weights yet.", { status: 404 });

  const components = grades.byEmployee.values().next().value?.grade.components ?? [];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Course Results");
  sheet.addRow([
    "Course", "Employee Code", "Learner", "Email", "Company", "Classroom",
    ...components.map((component) => `${component.label} (weight ${component.weight})`),
    "Course Result /100", "Complete", "Pending", "Teacher Comments",
  ]);
  styleHeader(sheet.getRow(1));
  for (const enrollment of enrollments) {
    const row = grades.byEmployee.get(enrollment.employeeId);
    if (!row) continue;
    sheet.addRow([
      course.title,
      enrollment.employee.employeeCode,
      enrollment.employee.name,
      enrollment.employee.email,
      enrollment.employee.company.name,
      enrollment.classroom?.name ?? "",
      // Blank, not 0, for what has not been attempted: a 0 would read as a
      // score the learner earned.
      ...row.grade.components.map((component) => component.score ?? ""),
      row.grade.total,
      row.grade.complete ? "Yes" : "No",
      row.grade.pending.join(", "),
      row.teacherEvaluation?.comments ?? "",
    ]);
  }
  autoFit(sheet);
  sheet.getColumn(sheet.columnCount).width = 60;
  sheet.getColumn(sheet.columnCount).alignment = { vertical: "top", wrapText: true };
  return workbookResponse(workbook, `rdc-course-results-${course.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.xlsx`);
}
