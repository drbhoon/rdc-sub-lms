import { describe, expect, it } from "vitest";
import { buildFinalBank, checkGradingScheme, computeCourseGrade, finalIsStale, type GradingScheme } from "./course-grading";

const modules = [
  { id: "m1", label: "Module 1", hasAssessment: true },
  { id: "m2", label: "Module 2", hasAssessment: true },
  { id: "m3", label: "Module 3", hasAssessment: true },
  { id: "m4", label: "Module 4", hasAssessment: true },
];

// HR's own example: four modules at 10 each, teacher 20, final 40.
const hrExample: GradingScheme = {
  teacherAssessmentEnabled: true,
  teacherWeight: 20,
  finalWeight: 40,
  moduleWeights: { m1: 10, m2: 10, m3: 10, m4: 10 },
};

describe("grading scheme", () => {
  it("accepts HR's example, which totals 100", () => {
    const check = checkGradingScheme(hrExample, modules, true);
    expect(check.errors).toEqual([]);
    expect(check.total).toBe(100);
  });

  it("refuses weights that do not total exactly 100", () => {
    const check = checkGradingScheme({ ...hrExample, finalWeight: 30 }, modules, true);
    expect(check.total).toBe(90);
    expect(check.errors).toContain("The weights add up to 90. They must total exactly 100.");
  });

  it("does not count the teacher's weight once the teacher assessment is switched off", () => {
    // Unticking leaves 20 in the box; it must not silently keep counting.
    const check = checkGradingScheme({ ...hrExample, teacherAssessmentEnabled: false }, modules, true);
    expect(check.total).toBe(80);
    expect(check.errors.some((error) => error.includes("must total exactly 100"))).toBe(true);
  });

  it("allows a scheme without the teacher assessment", () => {
    const scheme = { teacherAssessmentEnabled: false, teacherWeight: 0, finalWeight: 40, moduleWeights: { m1: 15, m2: 15, m3: 15, m4: 15 } };
    expect(checkGradingScheme(scheme, modules, true).errors).toEqual([]);
  });

  it("requires the final assessment to carry weight", () => {
    const scheme = { teacherAssessmentEnabled: false, teacherWeight: 0, finalWeight: 0, moduleWeights: { m1: 25, m2: 25, m3: 25, m4: 25 } };
    expect(checkGradingScheme(scheme, modules, true).errors).toContain("The final assessment is required, so it must carry some weight.");
  });

  it("refuses fractional and out-of-range weights", () => {
    const check = checkGradingScheme({ ...hrExample, moduleWeights: { m1: 10.5, m2: 9.5, m3: -5, m4: 15 } }, modules, true);
    expect(check.errors).toContain("Module 1: the weight must be a whole number from 0 to 100.");
    expect(check.errors).toContain("Module 3: the weight must be a whole number from 0 to 100.");
  });

  it("ignores weights for modules that are not on the course", () => {
    const check = checkGradingScheme({ ...hrExample, moduleWeights: { ...hrExample.moduleWeights, elsewhere: 50 } }, modules, true);
    expect(check.total).toBe(100);
  });

  it("warns, without refusing, about weight on a module that has no quiz yet", () => {
    const check = checkGradingScheme(hrExample, [...modules.slice(0, 3), { id: "m4", label: "Module 4", hasAssessment: false }], true);
    expect(check.errors).toEqual([]);
    expect(check.warnings[0]).toContain("Module 4 carries 10 but has no active quiz yet");
  });

  it("warns when the final has not been built", () => {
    expect(checkGradingScheme(hrExample, modules, false).warnings).toContain(
      "No final assessment has been built yet. Build it below so learners can take it.",
    );
  });
});

describe("course result", () => {
  const labelled = modules.map(({ id, label }) => ({ id, label }));

  it("weights each component and totals out of 100", () => {
    const grade = computeCourseGrade({
      scheme: hrExample,
      modules: labelled,
      moduleScores: { m1: 100, m2: 80, m3: 60, m4: 40 },
      teacherScore: 75,
      finalScore: 50,
    });
    // 10+8+6+4 = 28 from modules, 15 from the teacher, 20 from the final.
    expect(grade.total).toBe(63);
    expect(grade.complete).toBe(true);
    expect(grade.components.map((component) => component.contribution)).toEqual([10, 8, 6, 4, 15, 20]);
  });

  it("counts nothing for what is not yet done, and says what is pending", () => {
    const grade = computeCourseGrade({
      scheme: hrExample,
      modules: labelled,
      moduleScores: { m1: 90, m2: null },
      teacherScore: null,
      finalScore: undefined,
    });
    expect(grade.total).toBe(9);
    expect(grade.complete).toBe(false);
    expect(grade.pending).toEqual(["Module 2", "Module 3", "Module 4", "Teacher assessment", "Final assessment"]);
  });

  it("leaves the teacher out entirely when the teacher assessment is off", () => {
    const grade = computeCourseGrade({
      scheme: { teacherAssessmentEnabled: false, teacherWeight: 20, finalWeight: 60, moduleWeights: { m1: 10, m2: 10, m3: 10, m4: 10 } },
      modules: labelled,
      moduleScores: { m1: 100, m2: 100, m3: 100, m4: 100 },
      teacherScore: 0,
      finalScore: 100,
    });
    expect(grade.components.some((component) => component.key === "teacher")).toBe(false);
    expect(grade.total).toBe(100);
  });

  it("rounds to one decimal place", () => {
    const grade = computeCourseGrade({
      scheme: { teacherAssessmentEnabled: false, teacherWeight: 0, finalWeight: 67, moduleWeights: { m1: 33 } },
      modules: labelled,
      moduleScores: { m1: 33.3 },
      teacherScore: null,
      finalScore: 66.7,
    });
    expect(grade.total).toBe(55.7);
  });
});

describe("final assessment bank", () => {
  const q = (text: string, order: number) => ({
    questionText: text, optionA: "a", optionB: "b", optionC: "c", optionD: "d", correctOption: "A", timeSeconds: 30, order,
  });

  it("takes every module's questions, in module order, renumbered", () => {
    const bank = buildFinalBank([
      { assessmentId: "quiz1", questions: [q("Second from one", 2), q("First from one", 1)] },
      { assessmentId: "quiz2", questions: [q("Only from two", 1)] },
    ]);
    expect(bank.questions.map((question) => [question.order, question.questionText])).toEqual([
      [1, "First from one"], [2, "Second from one"], [3, "Only from two"],
    ]);
    expect(bank.sourceAssessmentIds).toEqual(["quiz1", "quiz2"]);
  });

  it("keeps a question that two modules share only once", () => {
    const bank = buildFinalBank([
      { assessmentId: "quiz1", questions: [q("What is slump?", 1)] },
      { assessmentId: "quiz2", questions: [q("  what is   SLUMP? ", 1), q("Why cure concrete?", 2)] },
    ]);
    expect(bank.questions.map((question) => question.questionText)).toEqual(["What is slump?", "Why cure concrete?"]);
  });

  it("is stale once a module's quiz changes", () => {
    expect(finalIsStale(["quiz1", "quiz2"], ["quiz2", "quiz1"])).toBe(false);
    expect(finalIsStale(["quiz1", "quiz2"], ["quiz1", "quiz3"])).toBe(true);
    expect(finalIsStale(["quiz1"], ["quiz1", "quiz2"])).toBe(true);
  });
});

describe("conditions for passing the course", () => {
  const mods = modules.map(({ id, label }) => ({ id, label }));
  // m1..m4 at 10 each, teacher 20, final 40; every part needs 70, the total 75.
  const grade = (moduleScores: Record<string, number | null>, teacher: number | null, final: number | null, scheme: GradingScheme = hrExample) =>
    computeCourseGrade({ scheme, modules: mods, moduleScores, teacherScore: teacher, finalScore: final });
  const all80 = { m1: 80, m2: 80, m3: 80, m4: 80 };

  it("passes when every part is at 70 and the total reaches 75", () => {
    const result = grade(all80, 80, 80);
    expect(result.total).toBe(80);
    expect(result.passed).toBe(true);
    expect(result.shortfalls).toEqual([]);
    expect(result.overallPassMark).toBe(75);
  });

  it("does not pass with a high total if one part is below its own pass mark", () => {
    const result = grade({ ...all80, m2: 60 }, 100, 100);
    expect(result.total).toBeGreaterThanOrEqual(75);
    expect(result.passed).toBe(false);
    expect(result.shortfalls).toEqual(["Module 2: you scored 60%, and 70% is needed."]);
  });

  it("does not pass with every part at 70 but a total under 75", () => {
    const result = grade({ m1: 70, m2: 70, m3: 70, m4: 70 }, 70, 70);
    expect(result.total).toBe(70);
    expect(result.passed).toBe(false);
    expect(result.shortfalls).toEqual(["Course result: 70 out of 100 so far, and 75 is needed."]);
  });

  it("is not passed while something is still to do", () => {
    const result = grade(all80, null, null);
    expect(result.passed).toBe(false);
    expect(result.shortfalls).toContain("Teacher assessment: not done yet.");
    expect(result.shortfalls).toContain("Final assessment: not done yet.");
  });

  it("uses the admin's own pass marks, and 0 means no minimum", () => {
    const scheme: GradingScheme = { ...hrExample, overallPassPercent: 60, passMarks: { "module:m1": 50, final: 80, teacher: 0 } };
    const result = grade({ m1: 55, m2: 80, m3: 80, m4: 80 }, 10, 85, scheme);
    const marks = Object.fromEntries(result.components.map((component) => [component.key, component.passMark]));
    expect(marks).toMatchObject({ "module:m1": 50, "module:m2": 70, teacher: 0, final: 80 });
    expect(result.components.find((component) => component.key === "teacher")?.passed).toBe(true);
    expect(result.overallPassMark).toBe(60);
    // 5.5 + 24 + 2 + 34 = 65.5
    expect(result.total).toBe(65.5);
    expect(result.passed).toBe(true);
  });

  it("a part with no weight is not a condition", () => {
    const scheme: GradingScheme = { ...hrExample, moduleWeights: { m1: 30, m2: 10, m3: 0, m4: 0 }, teacherWeight: 20, finalWeight: 40 };
    const result = grade({ m1: 90, m2: 90, m3: 10, m4: 10 }, 90, 90, scheme);
    expect(result.passed).toBe(true);
  });

  it("checks the pass marks when saving", () => {
    expect(checkGradingScheme({ ...hrExample, overallPassPercent: 0 }, modules, true).errors.join(" ")).toMatch(/overall pass mark/);
    expect(checkGradingScheme({ ...hrExample, passMarks: { final: 101 } }, modules, true).errors.join(" ")).toMatch(/Each pass mark/);
    expect(checkGradingScheme({ ...hrExample, passMarks: { final: 70 }, overallPassPercent: 75 }, modules, true).errors).toEqual([]);
  });
});
