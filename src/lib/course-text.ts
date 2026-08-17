import { MIN_AI_SOURCE_CHARACTERS } from "./ai-study-pack";

export const OCR_TEXT_TOO_SHORT_MESSAGE =
  "No readable course text could be extracted, even after OCR. Use clearer slide images or upload a searchable PDF.";

export function normalizeCourseText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export async function courseTextWithOcr(
  extractedText: string,
  runOcr: () => Promise<string>,
) {
  const primaryText = normalizeCourseText(extractedText);
  if (primaryText.length >= MIN_AI_SOURCE_CHARACTERS) {
    return { text: primaryText, usedOcr: false };
  }

  const ocrText = normalizeCourseText(await runOcr());
  const combinedText = normalizeCourseText(`${primaryText} ${ocrText}`);
  if (combinedText.length < MIN_AI_SOURCE_CHARACTERS) {
    throw new Error(OCR_TEXT_TOO_SHORT_MESSAGE);
  }

  return { text: combinedText, usedOcr: true };
}
