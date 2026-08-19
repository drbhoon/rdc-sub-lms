import { describe, expect, it } from "vitest";
import { COURSE_AI_LANGUAGE_CODES, COURSE_AI_LANGUAGE_NAMES, isCourseAiLanguage } from "./course-ai-languages";

describe("course AI languages", () => {
  it("supports all configured learner voice languages", () => {
    expect(COURSE_AI_LANGUAGE_CODES).toEqual(["en", "hi", "ta", "te", "kn", "ml"]);
    expect(COURSE_AI_LANGUAGE_NAMES).toEqual({
      en: "English",
      hi: "Hindi",
      ta: "Tamil",
      te: "Telugu",
      kn: "Kannada",
      ml: "Malayalam",
    });
  });

  it("rejects unsupported and missing language codes", () => {
    expect(isCourseAiLanguage("te")).toBe(true);
    expect(isCourseAiLanguage("fr")).toBe(false);
    expect(isCourseAiLanguage(null)).toBe(false);
  });
});
