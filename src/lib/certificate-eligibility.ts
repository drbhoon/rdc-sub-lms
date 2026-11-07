export type CertificateEligibilityInput = {
  certificateEnabled: boolean;
  totalLessons: number;
  completedLessons: number;
  courseCompleted: boolean;
  hasActiveAssessment: boolean;
  hasPassedAssessment: boolean;
  hasActiveFeedbackForm: boolean;
  hasSubmittedFeedback: boolean;
  /**
   * The weighted course result, when an admin has set the course's scheme.
   * It then decides the assessment conditions (each part's pass mark and the
   * overall pass mark) in place of "pass every quiz". Absent: the old rule.
   */
  grade?: { passed: boolean; shortfalls: string[] } | null;
};

export function certificateEligibility(input: CertificateEligibilityInput) {
  const missing: string[] = [];

  if (!input.certificateEnabled) missing.push("Certificate is disabled for this course.");
  if (!input.totalLessons) missing.push("No published lessons are available.");
  if (!input.courseCompleted || input.completedLessons < input.totalLessons) missing.push("Complete all lessons.");
  // A course (or a module within it) with no assessment or no feedback form
  // configured is never a blocker — only what a teacher actually set up has
  // to be completed. This mirrors the per-module gate in
  // learn/courses/[id]/page.tsx and certificate-record.ts, which already
  // skip modules with nothing configured on them.
  if (input.grade) {
    if (!input.grade.passed) missing.push(...input.grade.shortfalls);
  } else if (input.hasActiveAssessment && !input.hasPassedAssessment) missing.push("Pass the MCQ assessment.");
  if (input.hasActiveFeedbackForm && !input.hasSubmittedFeedback) missing.push("Submit course feedback.");

  return {
    ready: missing.length === 0,
    missing,
  };
}
