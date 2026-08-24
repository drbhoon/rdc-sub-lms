import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { autoFit, styleHeader, workbookResponse } from "@/lib/excel-response";
import { routeCourseManager } from "@/lib/route-auth";

function stringifyValue(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join("; ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value ?? "");
}

function questionOptions(type: string, configured: unknown, values: string[]) {
  if (type === "RATING_1_5") return ["1", "2", "3", "4", "5"];
  if (type === "YES_NO") return ["Yes", "No"];
  if ((type === "SINGLE_CHOICE" || type === "MULTI_CHOICE") && Array.isArray(configured)) return configured.map(String);
  return [...new Set(values)].filter(Boolean);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!await routeCourseManager(id)) return new Response("Forbidden", { status: 403 });
  const formId = new URL(request.url).searchParams.get("formId") ?? "";
  const course = await db.course.findUnique({
    where: { id },
    include: {
      feedbackForms: {
        where: formId ? { id: formId } : undefined,
        include: {
          questions: { orderBy: { order: "asc" } },
          // courseContent + its lesson, to label which module each response
          // row belongs to now that feedback is answered per module.
          responses: { include: { employee: { include: { company: true } }, courseContent: { include: { lessons: true } }, answers: true }, orderBy: { submittedAt: "asc" } },
        },
        orderBy: { version: "desc" },
      },
    },
  });
  if (!course) return new Response("Not found", { status: 404 });
  const workbook = new ExcelJS.Workbook();
  const overview = workbook.addWorksheet("Overview");
  overview.addRow(["Feedback report", course.title]);
  styleHeader(overview.getRow(1));
  overview.addRow([]);
  overview.addRow(["Version", "Feedback form", "Question", "Question text", "Type", "Responses", "Answer option", "Count", "Percentage"]);
  styleHeader(overview.getRow(3));
  for (const form of course.feedbackForms) {
    for (const question of form.questions) {
      const rawValues = form.responses.flatMap((response) => {
        const answer = response.answers.find((item) => item.questionId === question.id);
        return Array.isArray(answer?.value) ? (answer.value as unknown[]).map(String) : answer ? [stringifyValue(answer.value)] : [];
      });
      const options = questionOptions(question.type, question.options, rawValues);
      if (["SHORT_TEXT", "LONG_TEXT"].includes(question.type)) {
        overview.addRow([form.version, form.title, question.order, question.questionText, question.type, rawValues.length, "See Details", "", ""]);
      } else {
        for (const option of options) {
          const count = rawValues.filter((value) => value.toLowerCase() === option.toLowerCase()).length;
          overview.addRow([form.version, form.title, question.order, question.questionText, question.type, rawValues.length, option, count, rawValues.length ? count / rawValues.length : 0]);
        }
      }
    }
  }
  overview.getColumn(9).numFmt = "0.0%";
  autoFit(overview);
  overview.getColumn(4).width = 52;

  const details = workbook.addWorksheet("Details");
  const maxQuestions = Math.max(0, ...course.feedbackForms.map((form) => form.questions.length));
  details.addRow(["Employee Code", "Learner", "Email", "Company", "Location", "Feedback form", "Version", "Module", "Date", "Time", ...Array.from({ length: maxQuestions }, (_, index) => `Q${index + 1}`), "Submission"]);
  styleHeader(details.getRow(1));
  for (const form of course.feedbackForms) {
    for (const response of form.responses) {
      const values = new Map(response.answers.map((answer) => [answer.questionId, answer.value]));
      details.addRow([
        response.employee.employeeCode, response.employee.name, response.employee.email, response.employee.company.name,
        response.employee.locationPlant ?? "", form.title, form.version, response.courseContent?.lessons[0]?.title ?? "Whole course",
        response.submittedAt, response.submittedAt,
        ...Array.from({ length: maxQuestions }, (_, index) => {
          const question = form.questions.find((item) => item.order === index + 1);
          return question ? stringifyValue(values.get(question.id)) : "";
        }),
        response.submittedAt,
      ]);
    }
  }
  details.getColumn(9).numFmt = "yyyy-mm-dd";
  details.getColumn(10).numFmt = "hh:mm:ss";
  details.getColumn(11 + maxQuestions).numFmt = "yyyy-mm-dd hh:mm:ss";
  autoFit(details);
  for (let column = 11; column < 11 + maxQuestions; column += 1) {
    details.getColumn(column).alignment = { vertical: "top", wrapText: true };
    details.getColumn(column).width = 34;
  }

  return workbookResponse(workbook, `rdc-feedback-report-${course.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.xlsx`);
}
