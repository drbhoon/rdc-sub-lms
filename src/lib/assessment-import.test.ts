import { describe, expect, it } from "vitest";
import { parseAssessmentRows } from "./assessment-import";

describe("parseAssessmentRows", () => {
  it("parses the RDC realtime quiz CSV shape", () => {
    const questions = parseAssessmentRows([{
      "Sr. No.": "1",
      Question: "5+8=",
      "Option A": "13",
      "Option B": "12",
      "Option C": "11",
      "Option D": "10",
      "Answer Option": "A",
      "Time Seconds": "15",
    }]);
    expect(questions[0]).toMatchObject({ questionText: "5+8=", correctOption: "A", timeSeconds: 15 });
  });

  it("rejects rows with missing required fields", () => {
    expect(() => parseAssessmentRows([{ Question: "Incomplete" }])).toThrow(/missing/);
  });
});
