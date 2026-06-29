import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { autoFit, styleHeader, workbookResponse } from "@/lib/excel-response";
import { routeCourseManager } from "@/lib/route-auth";

function stringifyValue(value: unknown) {
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value ?? "");
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!await routeCourseManager(id)) return new Response("Forbidden", { status: 403 });
  const course = await db.course.findUnique({
    where: { id },
    include: {
      feedbackForms: {
        include: {
          questions: { orderBy: { order: "asc" } },
          responses: { include: { employee: { include: { company: true } }, answers: true }, orderBy: { submittedAt: "asc" } },
        },
        orderBy: { version: "desc" },
      },
    },
  });
  if (!course) return new Response("Not found", { status: 404 });
  const workbook = new ExcelJS.Workbook();
  for (const form of course.feedbackForms) {
    const sheet = workbook.addWorksheet(`Feedback v${form.version}`);
    sheet.addRow(["Employee Code", "Learner", "Company", "Submitted At", ...form.questions.map((question) => `Q${question.order}: ${question.questionText}`)]);
    styleHeader(sheet.getRow(1));
    for (const response of form.responses) {
      const answers = new Map(response.answers.map((answer) => [answer.questionId, answer.value]));
      sheet.addRow([
        response.employee.employeeCode,
        response.employee.name,
        response.employee.company.name,
        response.submittedAt,
        ...form.questions.map((question) => stringifyValue(answers.get(question.id))),
      ]);
    }
    sheet.getColumn(4).numFmt = "yyyy-mm-dd hh:mm";
    autoFit(sheet);
  }
  if (!course.feedbackForms.length) {
    const sheet = workbook.addWorksheet("Feedback");
    sheet.addRow(["No feedback forms uploaded"]);
  }
  return workbookResponse(workbook, `rdc-feedback-${course.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.xlsx`);
}
