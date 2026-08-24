import "server-only";
import { certificateEligibility } from "@/lib/certificate-eligibility";
import { db } from "@/lib/db";

export type CertificateRecord = {
  certificateId: string;
  companyName: string;
  completedAt: Date;
  courseTitle: string;
  employeeCode: string;
  employeeName: string;
};

export async function getCertificateRecord(employeeId: string, courseId: string): Promise<CertificateRecord | null> {
  const enrollment = await db.enrollment.findUnique({
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

  if (!enrollment?.completedAt || enrollment.course.status !== "PUBLISHED") return null;

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
  const hasSubmittedFeedback = hasActiveFeedbackForm && enrollment.course.feedbackForms.every((form) => {
    if (form.courseContentId) return form.responses.some((response) => response.courseContentId === form.courseContentId);
    const responded = new Set(form.responses.map((response) => response.courseContentId));
    return publishedContentIds.length > 0 && publishedContentIds.every((id) => responded.has(id));
  });

  // Only the modules a teacher actually quizzed have to be PASSED — a module
  // with no active quiz is not a blocker, same reasoning as a course with no
  // quiz at all was never blocked on "pass the quiz you don't have".
  const hasActiveAssessment = enrollment.course.assessments.length > 0;
  const hasPassedAssessment = hasActiveAssessment && enrollment.course.assessments.every((assessment) => assessment.attempts.length > 0);

  const eligibility = certificateEligibility({
    certificateEnabled: enrollment.course.certificateEnabled,
    totalLessons: lessonIds.size,
    completedLessons,
    courseCompleted: true,
    hasActiveAssessment,
    hasPassedAssessment,
    hasActiveFeedbackForm,
    hasSubmittedFeedback,
  });

  if (!eligibility.ready) return null;

  return {
    certificateId: `${enrollment.courseId.slice(-4)}-${enrollment.id.slice(-6)}`.toUpperCase(),
    companyName: enrollment.employee.company.name,
    completedAt: enrollment.completedAt,
    courseTitle: enrollment.course.title,
    employeeCode: enrollment.employee.employeeCode,
    employeeName: enrollment.employee.name,
  };
}
