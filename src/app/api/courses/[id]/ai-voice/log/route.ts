import { CourseAiInteractionStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { BUDGET_INR, spentInr } from "@/lib/ai-budget";
import { db } from "@/lib/db";
import { routeUserWithRole } from "@/lib/route-auth";

const logSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  answer: z.string().trim().min(1).max(12000),
  language: z.enum(["en", "hi"]),
  model: z.string().trim().min(1).max(120),
  inputTokens: z.number().int().min(0).max(10_000_000).default(0),
  outputTokens: z.number().int().min(0).max(10_000_000).default(0),
  inputAudioTokens: z.number().int().min(0).max(10_000_000).default(0),
  outputAudioTokens: z.number().int().min(0).max(10_000_000).default(0),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await routeUserWithRole(UserRole.LEARNER);
  if (!user?.employeeId) return Response.json({ error: "Learner profile required" }, { status: 403 });
  const { id: courseId } = await context.params;
  const parsed = logSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Voice transcript could not be recorded" }, { status: 400 });
  const enrollment = await db.enrollment.findUnique({
    where: { employeeId_courseId: { employeeId: user.employeeId, courseId } },
    include: { course: { select: { status: true } } },
  });
  if (!enrollment || enrollment.course.status !== "PUBLISHED") return Response.json({ error: "Course is not available" }, { status: 404 });

  await db.courseAiInteraction.create({
    data: {
      courseId,
      employeeId: user.employeeId,
      question: parsed.data.question,
      answer: parsed.data.answer,
      status: CourseAiInteractionStatus.ANSWERED,
      model: parsed.data.model,
      inputTokens: parsed.data.inputTokens,
      outputTokens: parsed.data.outputTokens,
      inputAudioTokens: parsed.data.inputAudioTokens,
      outputAudioTokens: parsed.data.outputAudioTokens,
      channel: "VOICE",
      language: parsed.data.language,
      sourceRestricted: true,
    },
  });
  const spent = await spentInr(user.employeeId, courseId);
  return Response.json({ ok: true, limitReached: spent >= BUDGET_INR });
}
