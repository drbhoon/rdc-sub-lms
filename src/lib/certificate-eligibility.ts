export type CertificateEligibilityInput = {
  certificateEnabled: boolean;
  totalLessons: number;
  completedLessons: number;
  courseCompleted: boolean;
  hasActiveAssessment: boolean;
  hasPassedAssessment: boolean;
  hasActiveFeedbackForm: boolean;
  hasSubmittedFeedback: boolean;
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
  if (input.hasActiveAssessment && !input.hasPassedAssessment) missing.push("Pass the MCQ assessment.");
  if (input.hasActiveFeedbackForm && !input.hasSubmittedFeedback) missing.push("Submit course feedback.");

  return {
    ready: missing.length === 0,
    missing,
  };
}
