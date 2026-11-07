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

describe("certificate with the course's conditions", () => {
  it("is held back by the conditions, whatever the old quiz rule says", () => {
    const result = certificateEligibility({
      ...completeInput,
      hasActiveAssessment: true, hasPassedAssessment: true,
      grade: { passed: false, shortfalls: ["Final assessment: you scored 60%, and 70% is needed."] },
    });
    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(["Final assessment: you scored 60%, and 70% is needed."]);
  });

  it("is ready when the conditions are met, even if a quiz was not 'passed' by its old mark", () => {
    const result = certificateEligibility({ ...completeInput, hasActiveAssessment: true, hasPassedAssessment: false, grade: { passed: true, shortfalls: [] } });
    expect(result.ready).toBe(true);
  });

  it("still needs the lessons and the feedback", () => {
    const result = certificateEligibility({ ...completeInput, hasSubmittedFeedback: false, hasActiveFeedbackForm: true, grade: { passed: true, shortfalls: [] } });
    expect(result.missing).toEqual(["Submit course feedback."]);
  });
});
