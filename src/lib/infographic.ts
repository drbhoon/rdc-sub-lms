import { type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { istDay } from "@/lib/custom-report";
import { learnersOnly, notTeacherAttempt } from "@/lib/teacher-preview";

/**
 * The numbers behind the Infographic page: a handful of totals for the learners
 * in the chosen company and enrolment period. Every figure has one plain
 * definition (written beside it), so the page can be explained to anyone who
 * asks "what does 81% mean?".
 */

export type InfographicFilter = { companyId: string; from: string; to: string };

export type Infographic = {
  /** Share of enrolled learners who have started at least one course. */
  participation: number;
  /** Share of enrolled learners who did something (a lesson or an assessment) in the last 30 days. */
  engagement: number;
  /** Average lesson progress across all enrolments. */
  progress: number;
  /** Share of enrolments that are completed. */
  completionRate: number;
  learners: number;
  teachers: number;
  plants: number;
  classrooms: number;
  enrolments: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  attempts: number;
  passed: number;
  notPassed: number;
  averageScore: number;
  hoursSpent: number;
  videos: number;
  documents: number;
  modules: number;
  /** Completed enrolments on courses that issue a certificate. */
  certificates: number;
  feedbackReplies: number;
  averageRating: number | null;
  aiQuestions: number;
};

const ACTIVE_DAYS = 30;
const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

export async function loadInfographic(filter: InfographicFilter, now = new Date()): Promise<Infographic> {
  const { companyId } = filter;
  const range = (field: "gte" | "lte", value: string, end: boolean) => (value ? { [field]: istDay(value, end) } : {});
  const within = { ...range("gte", filter.from, false), ...range("lte", filter.to, true) };
  const hasRange = Boolean(filter.from || filter.to);

  const enrolWhere: Prisma.EnrollmentWhereInput = {
    ...learnersOnly,
    ...(companyId ? { employee: { companyId } } : {}),
    ...(hasRange ? { enrolledAt: within } : {}),
  };
  const courseWhere: Prisma.CourseWhereInput = companyId ? { companies: { some: { companyId } } } : {};
  const since = new Date(now.getTime() - ACTIVE_DAYS * 86_400_000);

  const [enrolments, lessonCounts, recentLessons, recentAttempts, watched, attempts, scores, teachers, classrooms,
    videos, documents, modules, feedbackReplies, ratingAnswers, aiQuestions] = await Promise.all([
    db.enrollment.findMany({
      where: enrolWhere,
      select: {
        employeeId: true, courseId: true, status: true, startedAt: true,
        employee: { select: { locationPlant: true } },
        course: { select: { certificateEnabled: true } },
        _count: { select: { progress: { where: { completedAt: { not: null } } } } },
      },
    }),
    db.course.findMany({
      select: { id: true, contents: { where: { isPublished: true }, select: { _count: { select: { lessons: { where: { approvedAt: { not: null } } } } } } } },
    }),
    db.lessonProgress.findMany({ where: { updatedAt: { gte: since }, enrollment: enrolWhere }, distinct: ["enrollmentId"], select: { enrollment: { select: { employeeId: true } } } }),
    db.assessmentAttempt.findMany({
      where: { status: "SUBMITTED", submittedAt: { gte: since }, ...notTeacherAttempt, employee: { enrollments: { some: enrolWhere } } },
      distinct: ["employeeId"], select: { employeeId: true },
    }),
    db.lessonProgress.aggregate({ where: { enrollment: enrolWhere }, _sum: { watchedSeconds: true } }),
    db.assessmentAttempt.groupBy({
      by: ["passed"],
      where: { status: "SUBMITTED", ...notTeacherAttempt, ...(companyId ? { employee: { companyId } } : {}), ...(hasRange ? { submittedAt: within } : {}) },
      _count: { _all: true },
    }),
    db.assessmentAttempt.aggregate({
      where: { status: "SUBMITTED", ...notTeacherAttempt, ...(companyId ? { employee: { companyId } } : {}), ...(hasRange ? { submittedAt: within } : {}) },
      _avg: { scorePercent: true },
    }),
    db.user.count({ where: { coursesTaught: { some: { course: courseWhere } } } }),
    db.classroom.count({ where: { course: courseWhere } }),
    db.lesson.count({ where: { type: "VIDEO", approvedAt: { not: null }, content: { isPublished: true, course: courseWhere } } }),
    db.lesson.count({ where: { type: { not: "VIDEO" }, approvedAt: { not: null }, content: { isPublished: true, course: courseWhere } } }),
    db.courseContent.count({ where: { isPublished: true, course: courseWhere } }),
    db.feedbackResponse.count({ where: { ...(companyId ? { employee: { companyId } } : {}), ...(hasRange ? { submittedAt: within } : {}) } }),
    db.feedbackAnswer.findMany({
      where: { question: { type: "RATING_1_5" }, response: { ...(companyId ? { employee: { companyId } } : {}), ...(hasRange ? { submittedAt: within } : {}) } },
      select: { value: true },
    }),
    db.courseAiInteraction.count({ where: { ...(companyId ? { employee: { companyId } } : {}), ...(hasRange ? { createdAt: within } : {}) } }),
  ]);

  const lessonsInCourse = new Map(lessonCounts.map((course) => [course.id, course.contents.reduce((sum, content) => sum + content._count.lessons, 0)]));
  const learnerIds = new Set(enrolments.map((e) => e.employeeId));
  const startedIds = new Set(enrolments.filter((e) => e.startedAt || e.status !== "NOT_STARTED").map((e) => e.employeeId));
  const activeIds = new Set([...recentLessons.map((r) => r.enrollment.employeeId), ...recentAttempts.map((a) => a.employeeId)]);
  const activeAmongLearners = [...activeIds].filter((id) => learnerIds.has(id)).length;

  const progressShares = enrolments.map((e) => {
    const total = lessonsInCourse.get(e.courseId) ?? 0;
    return total ? Math.min(1, e._count.progress / total) : 0;
  });
  const completed = enrolments.filter((e) => e.status === "COMPLETED").length;
  const inProgress = enrolments.filter((e) => e.status === "IN_PROGRESS").length;
  const plants = new Set(enrolments.map((e) => (e.employee.locationPlant ?? "").trim()).filter(Boolean));

  const attemptCount = attempts.reduce((sum, row) => sum + row._count._all, 0);
  const passed = attempts.find((row) => row.passed)?._count._all ?? 0;

  const ratings = ratingAnswers.map((answer) => Number(answer.value)).filter((value) => Number.isFinite(value) && value >= 1 && value <= 5);

  return {
    participation: percent(startedIds.size, learnerIds.size),
    engagement: percent(activeAmongLearners, learnerIds.size),
    progress: percent(progressShares.reduce((sum, share) => sum + share, 0), enrolments.length),
    completionRate: percent(completed, enrolments.length),
    learners: learnerIds.size,
    teachers,
    plants: plants.size,
    classrooms,
    enrolments: enrolments.length,
    completed,
    inProgress,
    notStarted: enrolments.length - completed - inProgress,
    attempts: attemptCount,
    passed,
    notPassed: attemptCount - passed,
    averageScore: Math.round((scores._avg.scorePercent ?? 0) * 10) / 10,
    hoursSpent: Math.round(((watched._sum.watchedSeconds ?? 0) / 3600) * 10) / 10,
    videos,
    documents,
    modules,
    certificates: enrolments.filter((e) => e.status === "COMPLETED" && e.course.certificateEnabled).length,
    feedbackReplies,
    averageRating: ratings.length ? Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 10) / 10 : null,
    aiQuestions,
  };
}
