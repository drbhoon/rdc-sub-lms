/**
 * How a course's result is made up, and what a learner has earned under it.
 *
 * A course is assessed three ways (HR, 2026-09-24):
 *   a. each module's quiz, with a weight of its own;
 *   b. optionally, the teacher's own assessment — one score and comments;
 *   c. a final assessment drawing questions from every module's bank.
 * An admin gives each a weight, and the weights must total exactly 100 — e.g. a
 * four-module course with the teacher ticked: 10 per module, 20 for the
 * teacher, 40 for the final.
 *
 * Everything here is pure so the rules can be tested without a database; the
 * actions and pages only load data and hand it in.
 */

export const WEIGHT_TOTAL = 100;
/** Unless an admin says otherwise: each part must reach this, and the weighted course result must reach the other. */
export const DEFAULT_COMPONENT_PASS = 70;
export const DEFAULT_OVERALL_PASS = 75;

export type GradingScheme = {
  teacherAssessmentEnabled: boolean;
  teacherWeight: number;
  finalWeight: number;
  /** courseContentId -> weight. A module missing from the map weighs nothing. */
  moduleWeights: Record<string, number>;
  /** The weighted course result needed to pass, out of 100. Default 75. */
  overallPassPercent?: number;
  /**
   * The score each part must reach on its own, keyed like a result column:
   * "module:<courseContentId>", "teacher", "final". A part missing here needs
   * DEFAULT_COMPONENT_PASS; 0 means that part has no minimum of its own.
   */
  passMarks?: Record<string, number>;
};

export type SchemeModule = {
  id: string;
  label: string;
  /** Whether the module has an ACTIVE quiz a learner could earn its weight on. */
  hasAssessment: boolean;
};

export type SchemeCheck = {
  /** Anything here blocks saving. */
  errors: string[];
  /** Worth saying, but a scheme can still be saved with these. */
  warnings: string[];
  total: number;
};

function isWeight(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= WEIGHT_TOTAL;
}

/** The scheme's weights, keeping only modules that belong to this course. */
export function normaliseScheme(scheme: GradingScheme, modules: Pick<SchemeModule, "id">[]): GradingScheme {
  const known = new Set(modules.map((module) => module.id));
  const moduleWeights: Record<string, number> = {};
  for (const [id, weight] of Object.entries(scheme.moduleWeights ?? {})) {
    if (known.has(id)) moduleWeights[id] = Number(weight);
  }
  const passMarks: Record<string, number> = {};
  const keys = new Set([...modules.map((module) => `module:${module.id}`), "teacher", "final"]);
  for (const [key, mark] of Object.entries(scheme.passMarks ?? {})) {
    if (keys.has(key)) passMarks[key] = Number(mark);
  }
  return {
    teacherAssessmentEnabled: scheme.teacherAssessmentEnabled,
    // Switched off means it counts for nothing, whatever the box last held.
    teacherWeight: scheme.teacherAssessmentEnabled ? Number(scheme.teacherWeight) : 0,
    finalWeight: Number(scheme.finalWeight),
    moduleWeights,
    overallPassPercent: scheme.overallPassPercent === undefined ? DEFAULT_OVERALL_PASS : Number(scheme.overallPassPercent),
    passMarks,
  };
}

/** What a part must score: the admin's mark for it, else the default. */
export function passMarkFor(scheme: Pick<GradingScheme, "passMarks">, key: string): number {
  const mark = scheme.passMarks?.[key];
  return typeof mark === "number" && Number.isFinite(mark) ? mark : DEFAULT_COMPONENT_PASS;
}

export function schemeTotal(scheme: GradingScheme) {
  const modules = Object.values(scheme.moduleWeights).reduce((sum, weight) => sum + (Number(weight) || 0), 0);
  return modules + (scheme.teacherAssessmentEnabled ? Number(scheme.teacherWeight) || 0 : 0) + (Number(scheme.finalWeight) || 0);
}

/**
 * Whether a scheme may be saved. The hard rules: every weight is a whole
 * number from 0 to 100, the final assessment carries weight (it is required),
 * and the weights total exactly 100.
 */
export function checkGradingScheme(input: GradingScheme, modules: SchemeModule[], hasFinal: boolean): SchemeCheck {
  const scheme = normaliseScheme(input, modules);
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const courseModule of modules) {
    const weight = scheme.moduleWeights[courseModule.id] ?? 0;
    if (!isWeight(weight)) errors.push(`${courseModule.label}: the weight must be a whole number from 0 to 100.`);
    else if (weight > 0 && !courseModule.hasAssessment) warnings.push(`${courseModule.label} carries ${weight} but has no active quiz yet, so nobody can earn it until one is uploaded.`);
    else if (weight === 0 && courseModule.hasAssessment) warnings.push(`${courseModule.label} has a quiz but no weight, so its score will not count towards the course result.`);
  }
  if (!isWeight(scheme.finalWeight)) errors.push("Final assessment: the weight must be a whole number from 0 to 100.");
  else if (scheme.finalWeight === 0) errors.push("The final assessment is required, so it must carry some weight.");
  if (scheme.teacherAssessmentEnabled) {
    if (!isWeight(scheme.teacherWeight)) errors.push("Teacher assessment: the weight must be a whole number from 0 to 100.");
    else if (scheme.teacherWeight === 0) warnings.push("Teacher assessment is ticked but carries no weight, so teachers' scores will not count.");
  }

  const overall = scheme.overallPassPercent ?? DEFAULT_OVERALL_PASS;
  if (!Number.isInteger(overall) || overall < 1 || overall > 100) errors.push("The overall pass mark must be a whole number from 1 to 100.");
  if (Object.values(scheme.passMarks ?? {}).some((mark) => !Number.isInteger(mark) || mark < 0 || mark > 100)) {
    errors.push("Each pass mark must be a whole number from 0 to 100 (0 means no minimum for that part).");
  }

  const total = schemeTotal(scheme);
  if (total !== WEIGHT_TOTAL) errors.push(`The weights add up to ${total}. They must total exactly ${WEIGHT_TOTAL}.`);
  if (scheme.finalWeight > 0 && !hasFinal) warnings.push("No final assessment has been built yet. Build it below so learners can take it.");

  return { errors, warnings, total };
}

// ─── A learner's result ─────────────────────────────────────────────────────

export type GradeComponent = {
  key: string;
  label: string;
  weight: number;
  /** Out of 100, or null when there is nothing to count yet. */
  score: number | null;
  /** What this component adds to the course result, out of its weight. */
  contribution: number;
  /** The score this part must reach on its own (0 = no minimum). */
  passMark: number;
  /** Whether the part meets its pass mark; null until it has a score. */
  passed: boolean | null;
};

export type CourseGrade = {
  components: GradeComponent[];
  /** Out of 100, to one decimal place. */
  total: number;
  /** True once every weighted component has a score. */
  complete: boolean;
  /** Labels of the weighted components still without a score. */
  pending: string[];
  /** The weighted result needed overall. */
  overallPassMark: number;
  /**
   * Passed the course: every part done and at its own pass mark, and the
   * weighted result at the overall pass mark. What the certificate needs.
   */
  passed: boolean;
  /** Plain reasons the course is not passed yet, for the learner and the certificate page. Empty when passed. */
  shortfalls: string[];
};

export type GradeInput = {
  scheme: GradingScheme;
  modules: { id: string; label: string }[];
  /** courseContentId -> best score out of 100, or null if never attempted. */
  moduleScores: Record<string, number | null | undefined>;
  teacherScore: number | null | undefined;
  finalScore: number | null | undefined;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * The weighted course result.
 *
 * Something not yet attempted adds nothing — so the running total only ever
 * rises as a learner works through the course — and it is listed as pending,
 * so nobody mistakes an unfinished result for a final one.
 */
export function computeCourseGrade(input: GradeInput): CourseGrade {
  const scheme = normaliseScheme(input.scheme, input.modules);
  const components: GradeComponent[] = [];
  const add = (key: string, label: string, weight: number, raw: number | null | undefined) => {
    if (!(weight > 0)) return;
    const score = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : null;
    const passMark = passMarkFor(scheme, key);
    components.push({
      key, label, weight, score, contribution: score === null ? 0 : round1((weight * score) / 100),
      passMark, passed: score === null ? null : score >= passMark,
    });
  };

  for (const courseModule of input.modules) add(`module:${courseModule.id}`, courseModule.label, scheme.moduleWeights[courseModule.id] ?? 0, input.moduleScores[courseModule.id]);
  if (scheme.teacherAssessmentEnabled) add("teacher", "Teacher assessment", scheme.teacherWeight, input.teacherScore);
  add("final", "Final assessment", scheme.finalWeight, input.finalScore);

  const pending = components.filter((component) => component.score === null).map((component) => component.label);
  const total = round1(components.reduce((sum, component) => sum + (component.score === null ? 0 : (component.weight * component.score) / 100), 0));
  const complete = pending.length === 0 && components.length > 0;
  const overallPassMark = scheme.overallPassPercent ?? DEFAULT_OVERALL_PASS;

  const shortfalls: string[] = [];
  for (const component of components) {
    if (component.score === null) shortfalls.push(`${component.label}: not done yet.`);
    else if (component.passed === false) shortfalls.push(`${component.label}: you scored ${component.score}%, and ${component.passMark}% is needed.`);
  }
  if (total < overallPassMark) shortfalls.push(`Course result: ${total} out of 100 so far, and ${overallPassMark} is needed.`);
  const passed = complete && shortfalls.length === 0;
  return { components, total, complete, pending, overallPassMark, passed, shortfalls };
}

// ─── The final assessment's bank ─────────────────────────────────────────────

export type BankQuestion = {
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: string;
  timeSeconds: number;
  order: number;
};

export type ModuleBank<Q extends BankQuestion = BankQuestion> = {
  assessmentId: string;
  questions: Q[];
};

function questionKey(question: BankQuestion) {
  return question.questionText.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The final assessment's question bank: every question from every module's
 * active quiz, in module order and then question order, renumbered from 1.
 *
 * A question that appears in more than one module's bank is kept once, so a
 * learner is never shown the same question twice in one final.
 */
export function buildFinalBank<Q extends BankQuestion>(banks: ModuleBank<Q>[]) {
  const seen = new Set<string>();
  const questions: (Omit<Q, "order"> & { order: number })[] = [];
  for (const bank of banks) {
    for (const question of [...bank.questions].sort((a, b) => a.order - b.order)) {
      const key = questionKey(question);
      if (seen.has(key)) continue;
      seen.add(key);
      questions.push({ ...question, order: questions.length + 1 });
    }
  }
  return { questions, sourceAssessmentIds: banks.map((bank) => bank.assessmentId) };
}

/**
 * True when the modules' active quizzes are no longer the ones the final was
 * built from — a module's quiz was replaced, or a module gained or lost one.
 */
export function finalIsStale(builtFrom: string[], activeModuleAssessmentIds: string[]) {
  const built = new Set(builtFrom);
  const active = new Set(activeModuleAssessmentIds);
  if (built.size !== active.size) return true;
  for (const id of active) if (!built.has(id)) return true;
  return false;
}
