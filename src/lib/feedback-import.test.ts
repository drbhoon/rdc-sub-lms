import { FeedbackQuestionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { parseFeedbackRows } from "./feedback-import";

describe("parseFeedbackRows", () => {
  it("parses google style feedback rows", () => {
    const rows = parseFeedbackRows([{ ORDER: "1", QUESTION: "Rate course", TYPE: "RATING_1_5", REQUIRED: "YES", OPTIONS: "" }]);
    expect(rows[0]).toMatchObject({ type: FeedbackQuestionType.RATING_1_5, required: true });
  });

  it("requires options for choice questions", () => {
    expect(() => parseFeedbackRows([{ QUESTION: "Pick one", TYPE: "SINGLE_CHOICE" }])).toThrow(/OPTIONS/);
  });
});
