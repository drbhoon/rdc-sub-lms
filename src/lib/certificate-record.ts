import "server-only";
import { certificateBlockers } from "@/lib/certificate-blockers";
import { certificateEligibility } from "@/lib/certificate-eligibility";
import { loadCourseGrades } from "@/lib/course-grades";
import { allFeedbackAnswered } from "@/lib/feedback-rules";
import { supersededQuizIds } from "@/lib/superseded-quizzes";
import { db } from "@/lib/db";

export type CertificateRecord = {
  certificateId: string;
  companyName: string;
  completedAt: Date;
  courseTitle: string;
  employeeCode: string;
  employeeName: string;
};

async function loadEnrollment(employeeId: string, courseId: string) {
  return db.enrollment.findUnique({
    where: { employeeId_courseId: { employeeId, courseId } },
    include: {
      employee: { include: { company: true } },
      progress: true,
      course: {
        include: {
          contents: {
            where: { isPublished: true },
            include: { lessons: { where: { approvedAt: { not: null } } } },
          },
          // Every ACTIVE assessment, not one — a quiz belongs to a module now,
          // and a certificate requires passing every module a teacher put one
          // on, not just whichever quiz happened to exist first.
          assessments: {
            where: { status: "ACTIVE" },
            include: {
              attempts: {
                where: { employeeId, status: "SUBMITTED", passed: true },
                take: 1,
              },
            },
          },
          // Every ACTIVE form, not one — a feedback form belongs to a module
          // now, same as an assessment does, so a course can have several
          // running together.
          feedbackForms: {
            where: { isActive: true },
            include: { responses: { where: { employeeId } } },
          },
        },
      },
    },
  });
}

type LoadedEnrollment = NonNullable<Awaited<ReturnType<typeof loadEnrollment>>>;

/** Every certificate condition, checked. Both the certificate and its explanation come from this. */
async function evaluate(enrollment: LoadedEnrollment, employeeId: string, courseId: string) {
  const lessonIds = new Set(
    enrollment.course.contents.flatMap((content) => content.lessons.map((lesson) => lesson.id)),
  );
  const completedLessons = enrollment.progress.filter(
    (progress) => lessonIds.has(progress.lessonId) && progress.completedAt,
  ).length;
  // This function is the one both the certificate PAGE and the certificate
  // PDF route call, so it is the actual gate — getting it wrong would let a
  // certificate through on one module's feedback out of several. Every
  // ACTIVE form needs its response(s): a module-scoped form needs its own
  // module covered; a form uploaded before forms were module-scoped (see
  // learn/courses/[id]/page.tsx for the same rule, in full) still needs
  // every published module covered under that one shared form.
  const publishedContentIds = enrollment.course.contents.map((content) => content.id);
  const hasActiveFeedbackForm = enrollment.course.feedbackForms.length > 0;
  const hasSubmittedFeedback = allFeedbackAnswered(enrollment.course.feedbackForms, publishedContentIds);

  // Only the modules a teacher actually quizzed have to be PASSED — a module
  // with no active quiz is not a blocker, same reasoning as a course with no
  // quiz at all was never blocked on "pass the quiz you don't have".
  // The same set the learner page hides, so a quiz they cannot see cannot hold
  // the certificate back.
  const superseded = supersededQuizIds(enrollment.course.assessments, enrollment.course.contents.length);
  const requiredAssessments = enrollment.course.assessments.filter((assessment) => !superseded.has(assessment.id));
  const hasActiveAssessment = requiredAssessments.length > 0;
  const hasPassedAssessment = hasActiveAssessment && requiredAssessments.every((assessment) => assessment.attempts.length > 0);

  // The course's own conditions, when an admin has set them: each part at its pass mark, and the total.
  const grade = (await loadCourseGrades(courseId, [employeeId]))?.byEmployee.get(employeeId)?.grade ?? null;

  const eligibility = certificateEligibility({
    certificateEnabled: enrollment.course.certificateEnabled,
    totalLessons: lessonIds.size,
    completedLessons,
    courseCompleted: true,
    hasActiveAssessment,
    hasPassedAssessment,
    hasActiveFeedbackForm,
    hasSubmittedFeedback,
    grade: grade ? { passed: grade.passed, shortfalls: grade.shortfalls } : null,
  });

  return { eligibility, completedLessons, totalLessons: lessonIds.size };
}

export async function getCertificateRecord(employeeId: string, courseId: string): Promise<CertificateRecord | null> {
  const enrollment = await loadEnrollment(employeeId, courseId);
  if (!enrollment?.completedAt || enrollment.course.status !== "PUBLISHED") return null;
  if (!(await evaluate(enrollment, employeeId, courseId)).eligibility.ready) return null;

  return {
    certificateId: `${enrollment.courseId.slice(-4)}-${enrollment.id.slice(-6)}`.toUpperCase(),
    companyName: enrollment.employee.company.name,
    completedAt: enrollment.completedAt,
    courseTitle: enrollment.course.title,
    employeeCode: enrollment.employee.employeeCode,
    employeeName: enrollment.employee.name,
  };
}

/**
 * Why a learner has no certificate for a course: every reason, in plain words, for the administrator
 * who tried to download it. Checks the same conditions as getCertificateRecord, but without stopping at the first.
 */
export async function explainMissingCertificate(employeeId: string, courseId: string): Promise<{ employeeName: string | null; reasons: string[] }> {
  const enrollment = await loadEnrollment(employeeId, courseId);
  if (!enrollment) {
    const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { name: true } });
    return { employeeName: employee?.name ?? null, reasons: certificateBlockers({ enrolled: false, courseStatus: null, completedAt: null, completedLessons: 0, totalLessons: 0, missing: [] }) };
  }
  const { eligibility, completedLessons, totalLessons } = await evaluate(enrollment, employeeId, courseId);
  return {
    employeeName: enrollment.employee.name,
    reasons: certificateBlockers({ enrolled: true, courseStatus: enrollment.course.status, completedAt: enrollment.completedAt, completedLessons, totalLessons, missing: eligibility.missing }),
  };
}
