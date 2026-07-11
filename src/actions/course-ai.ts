"use server";

import { CourseAiInteractionStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
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

function jsonText(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n");
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

async function recordInteraction(input: {
  courseId: string;
  employeeId: string;
  question: string;
  answer?: string;
  error?: string;
  model?: string;
}) {
  await db.courseAiInteraction.create({
    data: {
      courseId: input.courseId,
      employeeId: input.employeeId,
      question: input.question,
      answer: input.answer,
      error: input.error,
      model: input.model,
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

  const source = enrollment.course.contents.map((content) => [
    `CONTENT: ${content.originalName}`,
    content.summary ? `Summary: ${content.summary}` : "",
    jsonText(content.keyPoints) ? `Key points:\n${jsonText(content.keyPoints)}` : "",
    jsonText(content.glossary) ? `Glossary:\n${jsonText(content.glossary)}` : "",
    content.extractedText ? `Source text:\n${content.extractedText}` : "",
  ].filter(Boolean).join("\n\n")).join("\n\n---\n\n").replace(/\s+/g, " ").trim();

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
  const answer = outputText(await response.json());
  if (answer) {
    await recordInteraction({ ...historyBase, answer });
    return { answer };
  }
  const message = "AI returned no answer.";
  await recordInteraction({ ...historyBase, error: message });
  return { message };
}
