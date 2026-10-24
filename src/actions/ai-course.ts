"use server";

import { randomUUID } from "node:crypto";
import { UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateStudyPack } from "@/lib/ai-study-pack";
import { costInr } from "@/lib/ai-budget";
import {
  AI_COURSE_LANGUAGES, MAX_AI_MODULES, MAX_BRIEF_CHARACTERS, MIN_BRIEF_CHARACTERS,
  generateLessonText, generateOutline, outlineSchema, studyPackLanguageNote, type AiCourseLanguage, type Outline,
} from "@/lib/ai-course";
import { audit } from "@/lib/audit";
import { requireCourseManager } from "@/lib/course-access";
import { createContentWithNextVersion } from "@/lib/course-content";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { enrolTeachersAsPreview } from "@/lib/teacher-preview";
import { requireRole } from "@/lib/session";

/** How many AI-written courses one person may start in a day. Each costs a few rupees; this stops a runaway click, not honest use. */
const DAILY_LIMIT_TEACHER = positive(process.env.LMS_AI_COURSE_DAILY_LIMIT, 5);
const DAILY_LIMIT_ADMIN = positive(process.env.LMS_AI_COURSE_DAILY_LIMIT_ADMIN, 20);
function positive(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const startSchema = z.object({
  brief: z.string().trim().min(MIN_BRIEF_CHARACTERS, "Describe the course in a sentence or two.").max(MAX_BRIEF_CHARACTERS, "Keep the description under 2000 characters."),
  audience: z.string().trim().max(300).optional(),
  language: z.enum(AI_COURSE_LANGUAGES),
  modules: z.coerce.number().int().min(1).max(MAX_AI_MODULES),
  companyIds: z.array(z.string().min(1)).min(1, "Choose at least one company.").max(100),
});

export type StartedCourse = {
  courseId: string;
  title: string;
  outline: Outline;
  modules: { contentId: string; title: string }[];
};

/** Midnight at the start of today in India, as a UTC instant. */
function startOfIstDay() {
  const IST = 330 * 60_000;
  const now = Date.now();
  return new Date(Math.floor((now + IST) / 86_400_000) * 86_400_000 - IST);
}

async function logUsage(actorId: string, courseId: string, step: string, usage: { inputTokens: number; outputTokens: number }) {
  await audit(actorId, "AI_COURSE_USAGE", "Course", courseId, { step, ...usage, costInr: Math.round(costInr(usage.inputTokens, usage.outputTokens) * 100) / 100 });
}

/** Step one: turn the brief into an outline and create the draft course with an empty module for each part. */
export async function startAiCourse(input: {
  brief: string; audience?: string; language: AiCourseLanguage; modules: number; companyIds: string[];
}): Promise<StartedCourse | { error: string }> {
  const actor = await requireRole(UserRole.TEACHER, UserRole.SUPER_ADMIN);
  if (!env.OPENAI_API_KEY) return { error: "AI is not set up on this server (no OpenAI key). Ask your administrator." };
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const isAdmin = actor.roles.some((grant) => grant.role === UserRole.SUPER_ADMIN);

  const today = await db.auditLog.count({ where: { actorUserId: actor.id, action: "AI_COURSE_CREATED", createdAt: { gte: startOfIstDay() } } });
  const limit = isAdmin ? DAILY_LIMIT_ADMIN : DAILY_LIMIT_TEACHER;
  if (today >= limit) return { error: `You have started ${today} AI courses today, which is the daily limit (${limit}). Try again tomorrow, or ask an administrator.` };
  const companies = await db.company.count({ where: { id: { in: parsed.data.companyIds } } });
  if (companies !== parsed.data.companyIds.length) return { error: "One of the chosen companies was not found." };

  let outline;
  try {
    outline = await generateOutline({ brief: parsed.data.brief, audience: parsed.data.audience, language: parsed.data.language, modules: parsed.data.modules });
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : "The AI could not plan the course." };
  }

  const course = await db.course.create({
    data: {
      title: outline.value.title, category: outline.value.category, description: outline.value.description,
      durationMinutes: outline.value.durationMinutes, status: "AI_PROCESSING", hasPendingChanges: true,
      companies: { create: parsed.data.companyIds.map((companyId) => ({ companyId })) },
      // A teacher who writes a course teaches it; an administrator assigns teachers afterwards.
      teachers: isAdmin ? undefined : { create: [{ userId: actor.id }] },
    },
  });
  if (!isAdmin) await enrolTeachersAsPreview(course.id, [actor.id]);
  const modules: StartedCourse["modules"] = [];
  for (const planned of outline.value.modules) {
    const content = await createContentWithNextVersion({
      courseId: course.id, originalName: planned.title, storedKey: `ai:${randomUUID()}`, mimeType: "text/x-lesson", sizeBytes: 0,
      type: "TEXT", processingStatus: "PROCESSING",
    });
    modules.push({ contentId: content.id, title: planned.title });
  }
  await audit(actor.id, "AI_COURSE_CREATED", "Course", course.id, { language: parsed.data.language, modules: modules.length, brief: parsed.data.brief.slice(0, 300) });
  await logUsage(actor.id, course.id, "outline", outline.usage);
  revalidatePath("/teacher/courses");
  revalidatePath("/admin/courses");
  return { courseId: course.id, title: outline.value.title, outline: outline.value, modules };
}

const writeSchema = z.object({
  courseId: z.string().min(1),
  contentId: z.string().min(1),
  moduleIndex: z.number().int().min(0).max(MAX_AI_MODULES - 1),
  language: z.enum(AI_COURSE_LANGUAGES),
  audience: z.string().trim().max(300).optional(),
  outline: outlineSchema,
});

/**
 * Step two, once per module: the reading, then the summary, key points,
 * glossary and quiz questions from it, saved the same way an uploaded
 * document's would be, so the teacher reviews and approves it in the usual way.
 * Safe to run again for a module that failed.
 */
export async function writeAiModule(input: z.input<typeof writeSchema>): Promise<{ ok: true; title: string } | { error: string }> {
  const parsed = writeSchema.safeParse(input);
  if (!parsed.success) return { error: "That request was not understood." };
  const { courseId, contentId, moduleIndex, language, audience, outline } = parsed.data;
  const actor = await requireCourseManager(courseId);
  const content = await db.courseContent.findFirst({ where: { id: contentId, courseId, type: "TEXT" } });
  if (!content) return { error: "That module was not found." };
  if (content.isPublished) return { error: "That module is already published." };

  try {
    await db.courseContent.update({ where: { id: contentId }, data: { processingStatus: "PROCESSING", processingError: null } });
    const lesson = await generateLessonText({ outline, moduleIndex, language, audience });
    const pack = await generateStudyPack(lesson.value, { languageNote: studyPackLanguageNote(language) });
    const title = outline.modules[moduleIndex].title;
    const model = env.OPENAI_MODEL;
    await db.$transaction([
      db.courseContent.update({
        where: { id: contentId },
        data: {
          originalName: title, sizeBytes: lesson.value.length, processingStatus: "COMPLETED", processingError: null,
          extractedText: lesson.value, summary: pack.summary, keyPoints: pack.keyPoints, glossary: pack.glossary, quizQuestions: pack.quizQuestions,
          aiModel: model, aiGeneratedAt: new Date(), approvedAt: null, rejectedAt: null,
        },
      }),
      db.lesson.upsert({
        where: { courseContentId_order: { courseContentId: contentId, order: 1 } },
        update: { title, body: lesson.value, summary: pack.summary, keyPoints: pack.keyPoints, approvedAt: null },
        create: { courseContentId: contentId, title, type: "TEXT", order: 1, pageCount: 1, body: lesson.value, summary: pack.summary, keyPoints: pack.keyPoints },
      }),
    ]);
    await logUsage(actor.id, courseId, `module ${moduleIndex + 1}`, lesson.usage);
    revalidatePath(`/teacher/courses/${courseId}`);
    revalidatePath(`/admin/courses/${courseId}`);
    return { ok: true, title };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message.slice(0, 500) : "The AI could not write this module.";
    await db.courseContent.update({ where: { id: contentId }, data: { processingStatus: "FAILED", processingError: message } }).catch(() => {});
    return { error: message };
  }
}

/** Step three: the course is ready for a teacher to review. Unfinished modules stay marked as such. */
export async function finishAiCourse(courseId: string): Promise<{ ready: number; failed: number }> {
  const actor = await requireCourseManager(courseId);
  const contents = await db.courseContent.findMany({ where: { courseId }, select: { processingStatus: true } });
  const ready = contents.filter((content) => content.processingStatus === "COMPLETED").length;
  const failed = contents.length - ready;
  await db.course.update({
    where: { id: courseId },
    data: { status: ready ? "PENDING_TEACHER_APPROVAL" : "DRAFT", hasPendingChanges: true },
  });
  await audit(actor.id, "AI_COURSE_FINISHED", "Course", courseId, { ready, failed });
  revalidatePath(`/teacher/courses/${courseId}`);
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/teacher/courses");
  revalidatePath("/admin/courses");
  return { ready, failed };
}
