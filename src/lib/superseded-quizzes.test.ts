import { describe, expect, it } from "vitest";
import { supersededQuizIds } from "./superseded-quizzes";

const moduleQuiz = { id: "m1", kind: "MODULE", courseContentId: "c1" };
const wholeCourse = { id: "w1", kind: "MODULE", courseContentId: null };
const final = { id: "f1", kind: "FINAL", courseContentId: null };

describe("supersededQuizIds", () => {
  it("drops the older whole-course quiz once the only module has its own", () => {
    expect([...supersededQuizIds([moduleQuiz, wholeCourse], 1)]).toEqual(["w1"]);
  });

  it("keeps the whole-course quiz when it is the only quiz the course has", () => {
    expect(supersededQuizIds([wholeCourse], 1).size).toBe(0);
  });

  it("leaves everything alone in a course with several modules", () => {
    expect(supersededQuizIds([moduleQuiz, { id: "m2", kind: "MODULE", courseContentId: "c2" }, wholeCourse], 2).size).toBe(0);
  });

  it("never touches the final assessment, which also has no module", () => {
    expect(supersededQuizIds([moduleQuiz, final], 1).size).toBe(0);
    expect(supersededQuizIds([final, wholeCourse], 1).size).toBe(0);
  });

  it("does nothing when there are no quizzes or no modules", () => {
    expect(supersededQuizIds([], 1).size).toBe(0);
    expect(supersededQuizIds([moduleQuiz, wholeCourse], 0).size).toBe(0);
  });
});
