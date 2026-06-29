import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { autoFit, styleHeader, workbookResponse } from "@/lib/excel-response";
import { routeCourseManager } from "@/lib/route-auth";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!await routeCourseManager(id)) return new Response("Forbidden", { status: 403 });
  const course = await db.course.findUnique({
    where: { id },
    include: {
      assessments: {
        include: {
          questions: { orderBy: { order: "asc" } },
          attempts: { include: { employee: { include: { company: true } }, answers: true }, orderBy: [{ startedAt: "desc" }] },
        },
        orderBy: { version: "desc" },
      },
    },
  });
  if (!course) return new Response("Not found", { status: 404 });
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet("Assessment Results");
  summary.addRow(["Course", "Assessment Version", "Employee Code", "Learner", "Company", "Attempt", "Score %", "Correct", "Total", "Passed", "Time Seconds", "Submitted At"]);
  styleHeader(summary.getRow(1));
  for (const assessment of course.assessments) {
    for (const attempt of assessment.attempts) {
      summary.addRow([
        course.title,
        assessment.version,
        attempt.employee.employeeCode,
        attempt.employee.name,
        attempt.employee.company.name,
        attempt.attemptNumber,
        attempt.scorePercent,
        attempt.correctAnswers,
        attempt.totalQuestions,
        attempt.passed ? "YES" : "NO",
        attempt.timeTakenSeconds,
        attempt.submittedAt,
      ]);
    }
  }
  summary.getColumn(7).numFmt = "0.0";
  summary.getColumn(12).numFmt = "yyyy-mm-dd hh:mm";
  autoFit(summary);

  const detail = workbook.addWorksheet("Answer Detail");
  detail.addRow(["Assessment Version", "Employee Code", "Learner", "Attempt", "Question No", "Question", "Selected", "Correct Answer", "Correct", "Time Seconds"]);
  styleHeader(detail.getRow(1));
  for (const assessment of course.assessments) {
    const questions = new Map(assessment.questions.map((question) => [question.id, question]));
    for (const attempt of assessment.attempts) {
      for (const answer of attempt.answers) {
        const question = questions.get(answer.questionId);
        detail.addRow([assessment.version, attempt.employee.employeeCode, attempt.employee.name, attempt.attemptNumber, question?.order, question?.questionText, answer.selectedOption ?? "", question?.correctOption, answer.isCorrect ? "YES" : "NO", answer.timeSpentSeconds]);
      }
    }
  }
  autoFit(detail);
  return workbookResponse(workbook, `rdc-assessment-results-${course.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.xlsx`);
}
