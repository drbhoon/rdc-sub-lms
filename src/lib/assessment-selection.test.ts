import { describe, expect, it } from "vitest";
import { selectAttemptQuestions } from "./assessment-selection";

const questions = Array.from({ length: 50 }, (_, index) => ({ id: `q-${index + 1}`, order: index + 1 }));

describe("selectAttemptQuestions", () => {
  it("keeps the random subset stable for an attempt", () => {
    const first = selectAttemptQuestions(questions, "attempt-1", 20, true).map((question) => question.id);
    const refresh = selectAttemptQuestions(questions, "attempt-1", 20, true).map((question) => question.id);
    expect(first).toEqual(refresh);
    expect(first).toHaveLength(20);
  });

  it("draws a fresh set for a retake", () => {
    const first = selectAttemptQuestions(questions, "attempt-1", 20, false).map((question) => question.id);
    const retake = selectAttemptQuestions(questions, "attempt-2", 20, false).map((question) => question.id);
    expect(first).not.toEqual(retake);
    expect(first).toEqual([...first].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))));
  });

  it("preserves legacy full-bank behavior", () => {
    expect(selectAttemptQuestions(questions, "legacy", 50, false)).toEqual(questions);
  });
});
