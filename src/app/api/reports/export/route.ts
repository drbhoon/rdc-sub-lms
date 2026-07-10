import ExcelJS from "exceljs";
import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { autoFit, styleHeader, workbookResponse } from "@/lib/excel-response";
import { buildLeaderboardRows, formatDuration } from "@/lib/leaderboard";
import { dateRangeWhere, getReportPeriod } from "@/lib/report-period";
import { routeUserWithRole } from "@/lib/route-auth";

function getParam(searchParams: URLSearchParams, key: string) {
  return searchParams.get(key) ?? "";
}

export async function GET(request: Request) {
  if (!await routeUserWithRole(UserRole.SUPER_ADMIN)) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const period = getReportPeriod(params);
  const periodRange = dateRangeWhere(period);
  const courseId = getParam(url.searchParams, "courseId");
  const companyId = getParam(url.searchParams, "companyId");

  const [progressRows, activeLearners, courseAnalysis, assessmentAttempts] = await Promise.all([
    db.enrollment.findMany({
      where: { enrolledAt: periodRange, ...(courseId ? { courseId } : {}), ...(companyId ? { employee: { companyId } } : {}) },
      include: {
        employee: { include: { company: true } },
        progress: true,
        course: { include: { contents: { where: { isPublished: true }, include: { lessons: { where: { approvedAt: { not: null } } } } } } },
      },
      orderBy: [{ course: { title: "asc" } }, { employee: { name: "asc" } }],
      take: 5000,
    }),
    db.employee.findMany({ where: { status: "ACTIVE", ...(companyId ? { companyId } : {}) }, include: { company: true }, orderBy: [{ company: { name: "asc" } }, { name: "asc" }], take: 5000 }),
    db.course.findMany({
      where: { ...(courseId ? { id: courseId } : {}), ...(companyId ? { companies: { some: { companyId } } } : {}) },
      include: { companies: { include: { company: true } }, enrollments: true },
      orderBy: { title: "asc" },
      take: 1000,
    }),
    db.assessmentAttempt.findMany({
      where: {
        status: "SUBMITTED",
        submittedAt: periodRange,
        ...(courseId ? { assessment: { courseId } } : {}),
        ...(companyId ? { employee: { companyId } } : {}),
      },
      include: { employee: { include: { company: true } }, assessment: { include: { course: true } } },
      orderBy: [{ scorePercent: "desc" }, { timeTakenSeconds: "asc" }],
      take: 5000,
    }),
  ]);

  const workbook = new ExcelJS.Workbook();
  const bestAttempts = new Map<string, (typeof assessmentAttempts)[number]>();
  for (const attempt of assessmentAttempts) {
    const key = `${attempt.employeeId}:${attempt.assessment.courseId}`;
    const existing = bestAttempts.get(key);
    if (!existing || attempt.scorePercent > existing.scorePercent || (attempt.scorePercent === existing.scorePercent && attempt.timeTakenSeconds < existing.timeTakenSeconds)) {
      bestAttempts.set(key, attempt);
    }
  }

  const progress = workbook.addWorksheet("Progress Assessment Tracker");
  progress.addRow(["Period", period.label]);
  progress.addRow([]);
  progress.addRow(["Employee Code", "Learner", "Company", "Course", "Status", "Lessons Completed", "Total Lessons", "Progress %", "Completed At", "Assessment Version", "Attempt", "Score %", "Correct", "Total Questions", "Passed", "Assessment Time Seconds", "Submitted At"]);
  styleHeader(progress.getRow(3));
  for (const enrollment of progressRows) {
    const totalLessons = enrollment.course.contents.flatMap((content) => content.lessons).length;
    const completedLessons = enrollment.progress.filter((item) => item.completedAt).length;
    const attempt = bestAttempts.get(`${enrollment.employeeId}:${enrollment.courseId}`);
    progress.addRow([
      enrollment.employee.employeeCode,
      enrollment.employee.name,
      enrollment.employee.company.name,
      enrollment.course.title,
      enrollment.status,
      completedLessons,
      totalLessons,
      totalLessons ? completedLessons / totalLessons : 0,
      enrollment.completedAt,
      attempt?.assessment.version ?? "",
      attempt?.attemptNumber ?? "",
      attempt?.scorePercent ?? "",
      attempt?.correctAnswers ?? "",
      attempt?.totalQuestions ?? "",
      attempt ? attempt.passed ? "YES" : "NO" : "",
      attempt?.timeTakenSeconds ?? "",
      attempt?.submittedAt ?? "",
    ]);
  }
  progress.getColumn(8).numFmt = "0.0%";
  progress.getColumn(9).numFmt = "yyyy-mm-dd";
  progress.getColumn(12).numFmt = "0.0";
  progress.getColumn(17).numFmt = "yyyy-mm-dd hh:mm";
  autoFit(progress);

  const learners = workbook.addWorksheet("Active Learners");
  learners.addRow(["Employee Code", "Name", "Email", "Company", "Department", "Designation", "Location/Plant"]);
  styleHeader(learners.getRow(1));
  activeLearners.forEach((employee) => learners.addRow([employee.employeeCode, employee.name, employee.email, employee.company.name, employee.department, employee.designation, employee.locationPlant ?? ""]));
  autoFit(learners);

  const courses = workbook.addWorksheet("Course Analysis");
  courses.addRow(["Course", "Companies", "Status", "Active", "Enrolled", "Completed", "Completion Rate"]);
  styleHeader(courses.getRow(1));
  for (const course of courseAnalysis) {
    const enrolled = course.enrollments.length;
    const completed = course.enrollments.filter((enrollment) => enrollment.status === "COMPLETED").length;
    courses.addRow([course.title, course.companies.map((company) => company.company.name).join(", "), course.status, course.isActive ? "YES" : "NO", enrolled, completed, enrolled ? completed / enrolled : 0]);
  }
  courses.getColumn(7).numFmt = "0.0%";
  autoFit(courses);

  const topperRows = buildLeaderboardRows(assessmentAttempts.map((attempt) => ({
    enrollmentId: attempt.id,
    courseId: attempt.assessment.courseId,
    courseTitle: attempt.assessment.course.title,
    employeeCode: attempt.employee.employeeCode,
    employeeName: attempt.employee.name,
    companyName: attempt.employee.company.name,
    enrolledAt: attempt.startedAt,
    startedAt: attempt.startedAt,
    completedAt: attempt.submittedAt,
    totalLessons: 100,
    completedLessons: 0,
    assessmentScorePercent: attempt.scorePercent,
    completionSecondsOverride: attempt.timeTakenSeconds,
  })), 100);
  const toppers = workbook.addWorksheet("Toppers");
  toppers.addRow(["Rank", "Employee Code", "Learner", "Company", "Course", "Rank Score", "Assessment Score", "Speed Score", "Completion Time"]);
  styleHeader(toppers.getRow(1));
  topperRows.forEach((row, index) => toppers.addRow([index + 1, row.employeeCode, row.employeeName, row.companyName, row.courseTitle, row.rankScore, row.progressScore, row.speedScore, formatDuration(row.completionSeconds)]));
  autoFit(toppers);

  return workbookResponse(workbook, "rdc-lms-reports.xlsx");
}
