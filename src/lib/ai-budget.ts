import { db } from "@/lib/db";

/**
 * Per-learner, per-course spend cap for the AI course assistant.
 *
 * The assistant calls OpenAI on the learner's behalf, so without a ceiling one
 * person asking questions all afternoon is unbounded spend. The cap is stated
 * in rupees rather than in questions because question cost varies by an order
 * of magnitude: a content-heavy course sends far more input tokens per
 * question than a light one, so "20 questions" would mean wildly different
 * money on different courses.
 *
 * Cost is computed from the token counts OpenAI actually reports, never from
 * an estimate. Study-pack generation (the worker) is NOT counted here — that
 * is a one-off per document, charged to the course rather than to a learner.
 */

// Published gpt-5.4-mini standard-tier rates, USD per 1M tokens, verified
// 2026-08-06 at https://developers.openai.com/api/docs/pricing
// Output is 6x input, which is why the output cap in course-ai.ts matters more
// than it looks. Update both if the model in OPENAI_MODEL changes.
const USD_PER_MTOK_INPUT = 0.75;
const USD_PER_MTOK_OUTPUT = 4.5;

/**
 * Read a positive number from the environment, falling back on anything
 * unusable. Number("") is 0, not NaN — without this guard an empty
 * LMS_AI_BUDGET_INR in .env would set the budget to zero and lock every
 * learner out of the assistant with no obvious cause.
 */
function positiveEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Rupees per learner, per course. */
export const BUDGET_INR = positiveEnv(process.env.LMS_AI_BUDGET_INR, 100);

const USD_TO_INR = positiveEnv(process.env.LMS_AI_USD_TO_INR, 95.2);

export function costInr(inputTokens: number, outputTokens: number): number {
  const usd =
    (inputTokens / 1_000_000) * USD_PER_MTOK_INPUT +
    (outputTokens / 1_000_000) * USD_PER_MTOK_OUTPUT;
  return usd * USD_TO_INR;
}

/** Rupees this learner has already spent on this course's assistant. */
export async function spentInr(employeeId: string, courseId: string): Promise<number> {
  const totals = await db.courseAiInteraction.aggregate({
    where: { employeeId, courseId },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return costInr(totals._sum.inputTokens ?? 0, totals._sum.outputTokens ?? 0);
}
