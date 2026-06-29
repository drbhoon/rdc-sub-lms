import { getField, type ImportRow } from "./tabular-import";

export type AssessmentImportQuestion = {
  order: number;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: "A" | "B" | "C" | "D";
  timeSeconds: number;
};

function parseCorrectOption(value: string) {
  const normalized = value.toUpperCase().replace(/OPTION|ANSWER|CORRECT/g, "");
  const match = normalized.match(/\b([A-D])\b/);
  if (match?.[1]) return match[1] as "A" | "B" | "C" | "D";
  const fallback = normalized.match(/[A-D]/)?.[0];
  return fallback as "A" | "B" | "C" | "D" | undefined;
}

function parseTimeSeconds(value: string) {
  const seconds = Number.parseInt(value || "30", 10);
  if (!Number.isFinite(seconds)) return 30;
  return Math.min(600, Math.max(5, seconds));
}

export function parseAssessmentRows(rows: ImportRow[]): AssessmentImportQuestion[] {
  if (!rows.length) throw new Error("The assessment file is empty.");
  if (rows.length > 300) throw new Error("Assessment upload is limited to 300 questions.");

  const questions = rows.map((row, index) => {
    const order = Number.parseInt(getField(row, ["Sr. No.", "Sr No", "Order", "No"]) || String(index + 1), 10);
    const questionText = getField(row, ["Question", "Questions", "question_text", "Question Text"]);
    const optionA = getField(row, ["Option A", "OptionA", "option_a", "A"]);
    const optionB = getField(row, ["Option B", "OptionB", "option_b", "B"]);
    const optionC = getField(row, ["Option C", "OptionC", "option_c", "C"]);
    const optionD = getField(row, ["Option D", "OptionD", "option_d", "D"]);
    const correctOption = parseCorrectOption(getField(row, ["Answer Option", "Answer", "correct_option", "Correct Answer", "Correct"]));
    const timeSeconds = parseTimeSeconds(getField(row, ["Time Seconds", "Time in Seconds", "time_seconds", "Duration", "Time"]));
    return { order: Number.isFinite(order) ? order : index + 1, questionText, optionA, optionB, optionC, optionD, correctOption, timeSeconds };
  });

  const errors: string[] = [];
  const valid: AssessmentImportQuestion[] = [];
  questions.forEach((question, index) => {
    if (!question.questionText || !question.optionA || !question.optionB || !question.optionC || !question.optionD || !question.correctOption) {
      errors.push(`Row ${index + 2} is missing question/options/correct answer.`);
    } else {
      valid.push(question as AssessmentImportQuestion);
    }
  });
  if (errors.length) throw new Error(errors.slice(0, 5).join(" "));
  return valid.sort((a, b) => a.order - b.order).map((question, index) => ({ ...question, order: index + 1 }));
}
