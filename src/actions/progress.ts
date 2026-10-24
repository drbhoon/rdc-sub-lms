"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { refreshEnrollment } from "@/lib/lesson-completion";
import { documentIsComplete, videoIsComplete } from "@/lib/progress";

export async function recordProgress(formData: FormData) {
  const user = await requireUser();
  if (!user.employeeId) throw new Error("Learner profile required");
  const lessonId = String(formData.get("lessonId"));
  const page = Number(formData.get("page") ?? 0);
  const watchedDelta = Math.max(0, Math.floor(Number(formData.get("watchedDelta") ?? 0)));
  const lesson = await db.lesson.findUniqueOrThrow({ where: { id: lessonId }, include: { content: { include: { course: true } } } });
  if (lesson.content.course.status !== "PUBLISHED" || !lesson.content.isPublished || !lesson.approvedAt) throw new Error("Lesson is unavailable");
  // A SCORM package and a live session record their own progress (from the package, and from the instructor).
  if (lesson.type === "SCORM" || lesson.type === "ILT") throw new Error("This lesson records its own progress");
  const enrollment = await db.enrollment.findUniqueOrThrow({ where: { employeeId_courseId: { employeeId: user.employeeId, courseId: lesson.content.courseId } } });
  const existing = await db.lessonProgress.findUnique({ where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId } } });
  const pages = new Set<number>(Array.isArray(existing?.viewedPages) ? (existing.viewedPages as number[]) : []);
  if (Number.isInteger(page) && page >= 1 && page <= lesson.pageCount) pages.add(page);
  const elapsedSinceEvent = existing ? Math.floor((Date.now() - existing.updatedAt.getTime()) / 1000) + 2 : 10;
  const acceptedDelta = Math.min(watchedDelta, 15, Math.max(0, elapsedSinceEvent));
  const newWatched = Math.min(lesson.durationSeconds ?? Number.MAX_SAFE_INTEGER, (existing?.watchedSeconds ?? 0) + acceptedDelta);
  // A text lesson is one page the learner reads; a YouTube lesson is watched like an uploaded video,
  // and when its length is unknown it counts as watched once the player says it reached the end.
  const ended = formData.get("ended") === "1";
  const documentComplete = (lesson.type === "DOCUMENT" || lesson.type === "TEXT") && documentIsComplete(lesson.pageCount, pages);
  const videoComplete = lesson.type === "VIDEO" && videoIsComplete(lesson.durationSeconds, newWatched, lesson.requiredWatchPercent);
  const youtubeComplete = lesson.type === "YOUTUBE"
    && (videoIsComplete(lesson.durationSeconds, newWatched, lesson.requiredWatchPercent) || (!lesson.durationSeconds && ended));
  const lessonDone = documentComplete || videoComplete || youtubeComplete;
  await db.$transaction(async (tx) => {
    await tx.lessonProgress.upsert({
      where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId } },
      update: { viewedPages: [...pages], watchedSeconds: newWatched, lastPosition: page || newWatched, completedAt: lessonDone ? existing?.completedAt ?? new Date() : null },
      create: { enrollmentId: enrollment.id, lessonId, viewedPages: [...pages], watchedSeconds: newWatched, lastPosition: page || newWatched, completedAt: lessonDone ? new Date() : null },
    });
    await refreshEnrollment(tx, enrollment, lesson.content.courseId);
  });
  revalidatePath(`/learn/courses/${lesson.content.courseId}`);
  // What the lesson player needs to tell the learner they have finished.
  return { lessonCompleted: lessonDone };
}
