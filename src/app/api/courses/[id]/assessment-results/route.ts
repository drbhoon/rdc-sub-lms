import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { autoFit, styleHeader, workbookResponse } from "@/lib/excel-response";
import { routeCourseManager } from "@/lib/route-auth";

const GREEN = "FFE2F0D9";
const RED = "FFF4CCCC";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!await routeCourseManager(id)) return new Response("Forbidden", { status: 403 });
  const assessmentId = new URL(request.url).searchParams.get("assessmentId") ?? "";
  const course = await db.course.findUnique({
    where: { id },
    include: {
      assessments: {
        where: assessmentId ? { id: assessmentId } : undefined,
        include: {
          questions: { orderBy: { order: "asc" } },
          attempts: {
            include: { employee: { include: { company: true } }, answers: { include: { question: true } } },
            orderBy: [{ startedAt: "asc" }],
          },
        },
        orderBy: { version: "desc" },
      },
    },
  });
  if (!course) return new Response("Not found", { status: 404 });
  const workbook = new ExcelJS.Workbook();
  const overview = workbook.addWorksheet("Overview");
  overview.addRow(["Assessment report", course.title]);
  styleHeader(overview.getRow(1));
  overview.addRow(["Summary basis", "Each learner's latest submitted attempt; Details contains every submitted attempt."]);
  overview.addRow([]);
  overview.addRow(["Version", "Assessment", "Question", "Question text", "Times answered", "Correct", "Correct %", "Option A", "A %", "Option B", "B %", "Option C", "C %", "Option D", "D %", "Correct answer"]);
  styleHeader(overview.getRow(4));

  for (const assessment of course.assessments) {
    const latest = new Map<string, (typeof assessment.attempts)[number]>();
    for (const attempt of assessment.attempts.filter((item) => item.status === "SUBMITTED")) {
      const current = latest.get(attempt.employeeId);
      if (!current || attempt.attemptNumber > current.attemptNumber) latest.set(attempt.employeeId, attempt);
    }
    for (const question of assessment.questions) {
      const answers = [...latest.values()].flatMap((attempt) => attempt.answers.filter((answer) => answer.questionId === question.id));
      const counts = Object.fromEntries(["A", "B", "C", "D"].map((option) => [option, answers.filter((answer) => answer.selectedOption === option).length])) as Record<string, number>;
      const correct = answers.filter((answer) => answer.isCorrect).length;
      const total = answers.length;
      overview.addRow([
        assessment.version, assessment.title, question.order, question.questionText, total, correct, total ? correct / total : 0,
        counts.A, total ? counts.A / total : 0, counts.B, total ? counts.B / total : 0,
        counts.C, total ? counts.C / total : 0, counts.D, total ? counts.D / total : 0, question.correctOption,
      ]);
    }
  }
  [7, 9, 11, 13, 15].forEach((column) => { overview.getColumn(column).numFmt = "0.0%"; });
  autoFit(overview);
  overview.getColumn(4).width = 48;

  const details = workbook.addWorksheet("Details");
  const maxQuestions = Math.max(0, ...course.assessments.map((assessment) => assessment.questions.length));
  details.addRow(["Employee Code", "Learner", "Email", "Company", "Location", "Assessment", "Version", "Date", "Time", "Score", "Status", "Attempt", ...Array.from({ length: maxQuestions }, (_, index) => `Q${index + 1}`), "Submission"]);
  styleHeader(details.getRow(1));
  for (const assessment of course.assessments) {
    for (const attempt of assessment.attempts.filter((item) => item.status === "SUBMITTED")) {
      const answers = new Map(attempt.answers.map((answer) => [answer.question.order, answer]));
      const submitted = attempt.submittedAt ?? attempt.startedAt;
      const row = details.addRow([
        attempt.employee.employeeCode, attempt.employee.name, attempt.employee.email, attempt.employee.company.name,
        attempt.employee.locationPlant ?? "", assessment.title, assessment.version, submitted, submitted,
        attempt.scorePercent / 100, attempt.passed ? "Passed" : "Not passed", attempt.attemptNumber,
        ...Array.from({ length: maxQuestions }, (_, index) => {
          const answer = answers.get(index + 1);
          if (!answer) return "";
          return answer.isCorrect ? `Correct (${answer.selectedOption})` : `Incorrect (${answer.selectedOption ?? "blank"}; correct ${answer.question.correctOption})`;
        }),
        submitted,
      ]);
      for (let index = 0; index < maxQuestions; index += 1) {
        const answer = answers.get(index + 1);
        if (answer) row.getCell(13 + index).fill = { type: "pattern", pattern: "solid", fgColor: { argb: answer.isCorrect ? GREEN : RED } };
      }
    }
  }
  details.getColumn(8).numFmt = "yyyy-mm-dd";
  details.getColumn(9).numFmt = "hh:mm:ss";
  details.getColumn(10).numFmt = "0.0%";
  details.getColumn(13 + maxQuestions).numFmt = "yyyy-mm-dd hh:mm:ss";
  autoFit(details);

  const timeline = workbook.addWorksheet("Timeline");
  timeline.addRow(["Event", "User", "Description", "Date"]);
  styleHeader(timeline.getRow(1));
  const events: Array<{ event: string; user: string; description: string; date: Date }> = [];
  for (const assessment of course.assessments) {
    for (const attempt of assessment.attempts) {
      const learner = `${attempt.employee.name} (${attempt.employee.employeeCode})`;
      events.push({ event: "Assessment started", user: learner, description: `${assessment.title} v${assessment.version}, attempt ${attempt.attemptNumber}`, date: attempt.startedAt });
      for (const answer of attempt.answers) {
        events.push({ event: "Answer submitted", user: learner, description: `Q${answer.question.order}: selected ${answer.selectedOption ?? "blank"} - ${answer.isCorrect ? "correct" : "incorrect"}`, date: answer.answeredAt });
      }
      if (attempt.submittedAt) events.push({ event: "Assessment submitted", user: learner, description: `Attempt ${attempt.attemptNumber}: ${attempt.scorePercent}% (${attempt.passed ? "passed" : "not passed"})`, date: attempt.submittedAt });
    }
  }
  events.sort((a, b) => a.date.getTime() - b.date.getTime()).forEach((event) => timeline.addRow([event.event, event.user, event.description, event.date]));
  timeline.getColumn(4).numFmt = "yyyy-mm-dd hh:mm:ss";
  autoFit(timeline);
  timeline.getColumn(3).width = 60;

  return workbookResponse(workbook, `rdc-assessment-report-${course.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.xlsx`);
}
