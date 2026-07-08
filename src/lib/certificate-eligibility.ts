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
  if (!input.hasActiveAssessment) missing.push("MCQ assessment is not configured.");
  else if (!input.hasPassedAssessment) missing.push("Pass the MCQ assessment.");
  if (!input.hasActiveFeedbackForm) missing.push("Feedback form is not configured.");
  else if (!input.hasSubmittedFeedback) missing.push("Submit course feedback.");

  return {
    ready: missing.length === 0,
    missing,
  };
}
