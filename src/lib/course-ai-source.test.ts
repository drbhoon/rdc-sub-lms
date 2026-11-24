import { describe, expect, it } from "vitest";
import { buildCourseAiSource } from "./course-ai-source";

const base = { extractedText: null, summary: null, keyPoints: null, glossary: null };

describe("buildCourseAiSource", () => {
  it("labels a file by its name when it stands alone", () => {
    const source = buildCourseAiSource([{ ...base, originalName: "Safety.pdf", summary: "Wear a helmet." }]);
    expect(source).toBe("CONTENT: Safety.pdf Summary: Wear a helmet.");
  });

  it("says which video module a reference file belongs to", () => {
    const source = buildCourseAiSource([
      { ...base, originalName: "Crusher.mp4" },
      { ...base, originalName: "Crusher slides.pptx", summary: "Jaw plates wear first.", referenceFor: { originalName: "Crusher.mp4" } },
    ]);
    expect(source).toContain('REFERENCE MATERIAL for the video module "Crusher.mp4": Crusher slides.pptx Summary: Jaw plates wear first.');
    expect(source).toContain("CONTENT: Crusher.mp4");
  });
});
