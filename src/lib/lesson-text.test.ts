import { describe, expect, it } from "vitest";
import { parseInline, parseLessonText } from "./lesson-text";

describe("parseLessonText", () => {
  it("reads headings, paragraphs and lists", () => {
    const blocks = parseLessonText("# Slump test\n\nMeasure the **slump** of fresh concrete.\nDo it twice.\n\n- Fill the cone\n- Tamp 25 times\n\n1. Lift\n2. Measure");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "Slump test" },
      { kind: "paragraph", text: "Measure the **slump** of fresh concrete. Do it twice." },
      { kind: "bullets", items: ["Fill the cone", "Tamp 25 times"] },
      { kind: "numbers", items: ["Lift", "Measure"] },
    ]);
  });
  it("keeps Hindi text as it is", () => {
    expect(parseLessonText("## कंक्रीट की जाँच\nस्लंप टेस्ट")).toEqual([
      { kind: "heading", level: 2, text: "कंक्रीट की जाँच" },
      { kind: "paragraph", text: "स्लंप टेस्ट" },
    ]);
  });
  it("shows markup as text instead of running it", () => {
    const [block] = parseLessonText("<script>alert(1)</script>");
    expect(block).toEqual({ kind: "paragraph", text: "<script>alert(1)</script>" });
  });
  it("an empty lesson has no blocks", () => {
    expect(parseLessonText("  \n \n")).toEqual([]);
  });
  it("a list ends at the next heading", () => {
    expect(parseLessonText("- a\n- b\n# Next")).toEqual([{ kind: "bullets", items: ["a", "b"] }, { kind: "heading", level: 1, text: "Next" }]);
  });
});

describe("parseInline", () => {
  it("marks bold and italic", () => {
    expect(parseInline("a **b** c *d*")).toEqual([{ text: "a " }, { text: "b", bold: true }, { text: " c " }, { text: "d", italic: true }]);
  });
  it("leaves plain text alone", () => {
    expect(parseInline("plain")).toEqual([{ text: "plain" }]);
  });
  it("leaves a lone asterisk alone", () => {
    expect(parseInline("5 * 3")).toEqual([{ text: "5 * 3" }]);
  });
});
