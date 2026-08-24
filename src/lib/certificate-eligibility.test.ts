import { describe, expect, it } from "vitest";
import { certificateEligibility } from "./certificate-eligibility";

const completeInput = {
  certificateEnabled: true,
  totalLessons: 2,
  completedLessons: 2,
  courseCompleted: true,
  hasActiveAssessment: true,
  hasPassedAssessment: true,
  hasActiveFeedbackForm: true,
  hasSubmittedFeedback: true,
};

describe("certificateEligibility", () => {
  it("allows certificate only after lessons, assessment, and feedback are complete", () => {
    expect(certificateEligibility(completeInput).ready).toBe(true);
  });

  it("blocks certificate before assessment is passed", () => {
    const result = certificateEligibility({ ...completeInput, hasPassedAssessment: false });
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("Pass the MCQ assessment.");
  });

  it("blocks certificate before feedback is submitted", () => {
    const result = certificateEligibility({ ...completeInput, hasSubmittedFeedback: false });
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("Submit course feedback.");
  });

  it("does not block a course with no assessment configured", () => {
    const result = certificateEligibility({ ...completeInput, hasActiveAssessment: false, hasPassedAssessment: false });
    expect(result.ready).toBe(true);
  });

  it("does not block a course with no feedback form configured", () => {
    const result = certificateEligibility({ ...completeInput, hasActiveFeedbackForm: false, hasSubmittedFeedback: false });
    expect(result.ready).toBe(true);
  });
});
