import { describe, expect, it, vi } from "vitest";
import { generateStudyPack, parseQuizQuestions } from "./ai-study-pack";

const questions = Array.from({ length: 5 }, (_, index) => ({
  question: `Which supported action is correct for scenario ${index + 1}?`,
  options: ["Inspect the area", "Ignore the issue", "Skip the procedure", "Hide the hazard"],
  correctAnswer: "Inspect the area",
  explanation: "The source requires inspection before work begins.",
}));

describe("AI study packs", () => {
  it("parses a structured Responses API result", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      output: [{ content: [{ type: "output_text", text: JSON.stringify({
        summary: "This course explains how employees identify hazards and report unsafe workplace conditions.",
        keyPoints: ["Inspect before starting", "Report unsafe conditions", "Use required protection"],
        glossary: [{ term: "Hazard", definition: "A condition that can cause harm." }],
        quizQuestions: questions,
      }) }] }],
    }), { status: 200 })) as typeof fetch;

    const result = await generateStudyPack("Employees inspect the work area before beginning. Unsafe conditions are reported to a manager and protective equipment is required.", {
      apiKey: "test-key", model: "test-model", fetchImpl,
    });

    expect(result.quizQuestions).toHaveLength(5);
    expect(result.quizQuestions[0].correctAnswer).toBe("Inspect the area");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects an answer that is not one of the options", () => {
    expect(parseQuizQuestions([{ ...questions[0], correctAnswer: "A fifth answer" }])).toEqual([]);
  });
});
