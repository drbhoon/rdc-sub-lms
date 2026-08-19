"use server";

import { CourseAiInteractionStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { BUDGET_INR, spentInr } from "@/lib/ai-budget";
import { buildCourseAiSource } from "@/lib/course-ai-source";
import { requireRole } from "@/lib/session";

export type CourseAiState = { message?: string; answer?: string };

const askSchema = z.object({
  courseId: z.string().min(1),
  question: z.string().trim().min(3, "Ask a more specific question.").max(1000, "Question is too long."),
});

function outputText(response: unknown) {
  const data = response as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return null;
}

async function recordInteraction(input: {
  courseId: string;
  employeeId: string;
  question: string;
  answer?: string;
  error?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}) {
  await db.courseAiInteraction.create({
    data: {
      courseId: input.courseId,
      employeeId: input.employeeId,
      question: input.question,
      answer: input.answer,
      error: input.error,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      channel: "TEXT",
      status: input.answer ? CourseAiInteractionStatus.ANSWERED : CourseAiInteractionStatus.FAILED,
      sourceRestricted: true,
    },
  }).catch(() => undefined);
}

export async function askCourseAi(_: CourseAiState, formData: FormData): Promise<CourseAiState> {
  const user = await requireRole(UserRole.LEARNER);
  if (!user.employeeId) return { message: "Learner profile required." };
  const parsed = askSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { message: parsed.error.issues[0].message };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { message: "AI assistant is not configured yet." };

  const enrollment = await db.enrollment.findUnique({
    where: { employeeId_courseId: { employeeId: user.employeeId, courseId: parsed.data.courseId } },
    include: {
      course: {
        include: {
          contents: {
            where: { isPublished: true },
            select: { originalName: true, extractedText: true, summary: true, keyPoints: true, glossary: true },
          },
        },
      },
    },
  });
  if (!enrollment || enrollment.course.status !== "PUBLISHED") return { message: "Course is not available." };
  const model = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
  const historyBase = { courseId: parsed.data.courseId, employeeId: user.employeeId, question: parsed.data.question, model };

  // Spend cap, checked BEFORE the call so the request that would exceed the
  // budget is never billed. Enforced on money rather than a question count
  // because cost per question varies by an order of magnitude with how much
  // course material has to be sent as context.
  if (await spentInr(user.employeeId, parsed.data.courseId) >= BUDGET_INR) {
    const message = "You have exceeded the number of questions allowed for this course.";
    await recordInteraction({ ...historyBase, error: message });
    return { message };
  }

  const source = buildCourseAiSource(enrollment.course.contents);

  if (source.length < 80) {
    const message = "AI assistant needs processed course text before it can answer.";
    await recordInteraction({ ...historyBase, error: message });
    return { message };
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        store: false,
        instructions: [
          "You are the RDC course assistant for an enrolled learner.",
          "Answer only using the supplied course source material.",
          "If the answer is not available in the course material, say that it is not covered in this course content.",
          "Keep the answer concise, practical, and learner-friendly.",
        ].join(" "),
        input: `COURSE: ${enrollment.course.title}\n\nCOURSE SOURCE MATERIAL:\n${source.slice(0, 60_000)}\n\nLEARNER QUESTION:\n${parsed.data.question}`,
        reasoning: { effort: "low" },
        max_output_tokens: 900,
        text: { verbosity: "low" },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "AI request timed out. Please try again." : "AI request could not be completed. Please try again.";
    await recordInteraction({ ...historyBase, error: message });
    return { message };
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    const message = failure?.error?.message?.slice(0, 300) ?? "AI request failed.";
    await recordInteraction({ ...historyBase, error: message });
    return { message };
  }
  const payload = await response.json();
  // Bill from what OpenAI reports, not from our own estimate. Recorded even
  // when no answer comes back, because those tokens were still charged —
  // omitting them would let a learner burn budget invisibly on empty replies.
  const usage = (payload as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  const billed = { inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens };

  const answer = outputText(payload);
  if (answer) {
    await recordInteraction({ ...historyBase, ...billed, answer });
    return { answer };
  }
  const message = "AI returned no answer.";
  await recordInteraction({ ...historyBase, ...billed, error: message });
  return { message };
}
