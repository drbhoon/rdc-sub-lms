import { FeedbackQuestionType } from "@prisma/client";
import { getField, type ImportRow } from "./tabular-import";

export type FeedbackImportQuestion = {
  order: number;
  questionText: string;
  type: FeedbackQuestionType;
  required: boolean;
  options: string[];
};

function parseType(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  if (normalized.includes("RATING")) return FeedbackQuestionType.RATING_1_5;
  if (normalized.includes("LONG")) return FeedbackQuestionType.LONG_TEXT;
  if (normalized.includes("YES") || normalized.includes("NO")) return FeedbackQuestionType.YES_NO;
  if (normalized.includes("MULTI")) return FeedbackQuestionType.MULTI_CHOICE;
  if (normalized.includes("CHOICE") || normalized.includes("SINGLE")) return FeedbackQuestionType.SINGLE_CHOICE;
  if (normalized.includes("SHORT")) return FeedbackQuestionType.SHORT_TEXT;
  return FeedbackQuestionType.SHORT_TEXT;
}

function parseRequired(value: string) {
  const normalized = value.trim().toUpperCase();
  return !["NO", "N", "FALSE", "OPTIONAL", "0"].includes(normalized);
}

export function parseFeedbackRows(rows: ImportRow[]): FeedbackImportQuestion[] {
  if (!rows.length) throw new Error("The feedback template is empty.");
  if (rows.length > 100) throw new Error("Feedback template is limited to 100 questions.");
  const errors: string[] = [];
  const questions = rows.map((row, index) => {
    const order = Number.parseInt(getField(row, ["ORDER", "Sr. No.", "Sr No", "No"]) || String(index + 1), 10);
    const questionText = getField(row, ["QUESTION", "Question Text", "Questions"]);
    const type = parseType(getField(row, ["TYPE", "Question Type"]));
    const required = parseRequired(getField(row, ["REQUIRED", "Mandatory"]));
    const options = getField(row, ["OPTIONS", "Choices"]).split("|").map((option) => option.trim()).filter(Boolean);
    if (!questionText) errors.push(`Row ${index + 2} is missing QUESTION.`);
    if ((type === FeedbackQuestionType.SINGLE_CHOICE || type === FeedbackQuestionType.MULTI_CHOICE) && options.length < 2) {
      errors.push(`Row ${index + 2} needs at least two OPTIONS separated by |.`);
    }
    return { order: Number.isFinite(order) ? order : index + 1, questionText, type, required, options };
  });
  if (errors.length) throw new Error(errors.slice(0, 5).join(" "));
  return questions.sort((a, b) => a.order - b.order).map((question, index) => ({ ...question, order: index + 1 }));
}
