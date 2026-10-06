import { describe, expect, it } from "vitest";
import { allFeedbackAnswered, isFeedbackFormAnswered, type FeedbackFormForRules } from "./feedback-rules";

const modules = ["m1", "m2"];
const form = (overrides: Partial<FeedbackFormForRules>): FeedbackFormForRules => ({ kind: "MODULE", courseContentId: "m1", responses: [], ...overrides });

describe("isFeedbackFormAnswered", () => {
  it("a module form needs a response for its own module", () => {
    expect(isFeedbackFormAnswered(form({}), modules)).toBe(false);
    expect(isFeedbackFormAnswered(form({ responses: [{ courseContentId: "m2" }] }), modules)).toBe(false);
    expect(isFeedbackFormAnswered(form({ responses: [{ courseContentId: "m1" }] }), modules)).toBe(true);
  });

  it("a legacy whole-course form needs every published module covered", () => {
    const legacy = form({ courseContentId: null });
    expect(isFeedbackFormAnswered({ ...legacy, responses: [{ courseContentId: "m1" }] }, modules)).toBe(false);
    expect(isFeedbackFormAnswered({ ...legacy, responses: [{ courseContentId: "m1" }, { courseContentId: "m2" }] }, modules)).toBe(true);
    expect(isFeedbackFormAnswered(legacy, [])).toBe(false);
  });

  it("a final form is answered by a single response, whatever the modules are", () => {
    const final = form({ kind: "FINAL", courseContentId: null });
    expect(isFeedbackFormAnswered(final, modules)).toBe(false);
    expect(isFeedbackFormAnswered({ ...final, responses: [{ courseContentId: null }] }, modules)).toBe(true);
    expect(isFeedbackFormAnswered({ ...final, responses: [{ courseContentId: null }] }, [])).toBe(true);
  });
});

describe("allFeedbackAnswered", () => {
  it("is false with nothing to answer, so a course without feedback is judged elsewhere", () => {
    expect(allFeedbackAnswered([], modules)).toBe(false);
  });

  it("holds the certificate back until the final feedback is in as well", () => {
    const moduleDone = form({ responses: [{ courseContentId: "m1" }] });
    const final = form({ kind: "FINAL", courseContentId: null });
    expect(allFeedbackAnswered([moduleDone, final], modules)).toBe(false);
    expect(allFeedbackAnswered([moduleDone, { ...final, responses: [{ courseContentId: null }] }], modules)).toBe(true);
  });
});
