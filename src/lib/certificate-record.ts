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
          feedbackForms: {
            where: { isActive: true },
            // Every response, not one: feedback is answered per module now, so
            // whether it is "done" means every published module is covered,
            // not merely that a row exists somewhere.
            include: { responses: { where: { employeeId } } },
            take: 1,
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
  const activeFeedbackForm = enrollment.course.feedbackForms[0];
  // Complete only once every PUBLISHED module has a response — the same rule
  // the learner-facing page uses (see feedbackSubmitted in
  // learn/courses/[id]/page.tsx). This function is the one both the
  // certificate PAGE and the certificate PDF route call, so it is the actual
  // gate: getting this wrong would let a certificate through on one module's
  // feedback out of several.
  const respondedContentIds = new Set((activeFeedbackForm?.responses ?? []).map((response) => response.courseContentId));
  const publishedContentIds = enrollment.course.contents.map((content) => content.id);
  const hasSubmittedFeedback = publishedContentIds.length > 0 && publishedContentIds.every((id) => respondedContentIds.has(id));

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
    hasActiveFeedbackForm: Boolean(activeFeedbackForm),
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
