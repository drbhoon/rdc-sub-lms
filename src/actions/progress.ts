"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { documentIsComplete, videoIsComplete } from "@/lib/progress";

export async function recordProgress(formData: FormData) {
  const user = await requireUser();
  if (!user.employeeId) throw new Error("Learner profile required");
  const lessonId = String(formData.get("lessonId"));
  const page = Number(formData.get("page") ?? 0);
  const watchedDelta = Math.max(0, Math.floor(Number(formData.get("watchedDelta") ?? 0)));
  const lesson = await db.lesson.findUniqueOrThrow({ where: { id: lessonId }, include: { content: { include: { course: true } } } });
  if (lesson.content.course.status !== "PUBLISHED" || !lesson.content.isPublished || !lesson.approvedAt) throw new Error("Lesson is unavailable");
  const enrollment = await db.enrollment.findUniqueOrThrow({ where: { employeeId_courseId: { employeeId: user.employeeId, courseId: lesson.content.courseId } } });
  const existing = await db.lessonProgress.findUnique({ where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId } } });
  const pages = new Set<number>(Array.isArray(existing?.viewedPages) ? (existing.viewedPages as number[]) : []);
  if (Number.isInteger(page) && page >= 1 && page <= lesson.pageCount) pages.add(page);
  const elapsedSinceEvent = existing ? Math.floor((Date.now() - existing.updatedAt.getTime()) / 1000) + 2 : 10;
  const acceptedDelta = Math.min(watchedDelta, 15, Math.max(0, elapsedSinceEvent));
  const newWatched = Math.min(lesson.durationSeconds ?? Number.MAX_SAFE_INTEGER, (existing?.watchedSeconds ?? 0) + acceptedDelta);
  const documentComplete = lesson.type === "DOCUMENT" && documentIsComplete(lesson.pageCount, pages);
  const videoComplete = lesson.type === "VIDEO" && videoIsComplete(lesson.durationSeconds, newWatched, lesson.requiredWatchPercent);
  await db.$transaction(async (tx) => {
    await tx.lessonProgress.upsert({
      where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId } },
      update: { viewedPages: [...pages], watchedSeconds: newWatched, lastPosition: page || newWatched, completedAt: documentComplete || videoComplete ? existing?.completedAt ?? new Date() : null },
      create: { enrollmentId: enrollment.id, lessonId, viewedPages: [...pages], watchedSeconds: newWatched, lastPosition: page || newWatched, completedAt: documentComplete || videoComplete ? new Date() : null },
    });
    const total = await tx.lesson.count({ where: { content: { courseId: lesson.content.courseId, approvedAt: { not: null }, isPublished: true } } });
    const completed = await tx.lessonProgress.count({ where: { enrollmentId: enrollment.id, completedAt: { not: null } } });
    await tx.enrollment.update({ where: { id: enrollment.id }, data: { status: total > 0 && completed >= total ? "COMPLETED" : "IN_PROGRESS", startedAt: enrollment.startedAt ?? new Date(), completedAt: total > 0 && completed >= total ? new Date() : null } });
  });
  revalidatePath(`/learn/courses/${lesson.content.courseId}`);
}
