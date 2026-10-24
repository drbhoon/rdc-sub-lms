import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Whether a learner has finished the course, recomputed after a lesson changes.
 *
 * One place, used by every kind of lesson (pages, video, YouTube, text, SCORM,
 * live sessions), so each of them completes a course by exactly the same rule:
 * every approved lesson of every published module is done.
 */
export async function refreshEnrollment(
  tx: Prisma.TransactionClient,
  enrollment: { id: string; startedAt: Date | null },
  courseId: string,
) {
  const total = await tx.lesson.count({ where: { content: { courseId, approvedAt: { not: null }, isPublished: true } } });
  const completed = await tx.lessonProgress.count({ where: { enrollmentId: enrollment.id, completedAt: { not: null } } });
  const done = total > 0 && completed >= total;
  await tx.enrollment.update({
    where: { id: enrollment.id },
    data: { status: done ? "COMPLETED" : "IN_PROGRESS", startedAt: enrollment.startedAt ?? new Date(), completedAt: done ? new Date() : null },
  });
}

/**
 * Mark one lesson complete for one enrolment, or take the completion back.
 * Used where the lesson is finished by something other than reading or
 * watching it here: a SCORM package reporting a pass, or an instructor marking
 * a learner present at a live session.
 */
export async function setLessonCompletion(enrollmentId: string, lessonId: string, completed: boolean) {
  const enrollment = await db.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: { id: true, startedAt: true, courseId: true },
  });
  await db.$transaction(async (tx) => {
    const existing = await tx.lessonProgress.findUnique({ where: { enrollmentId_lessonId: { enrollmentId, lessonId } } });
    const completedAt = completed ? existing?.completedAt ?? new Date() : null;
    await tx.lessonProgress.upsert({
      where: { enrollmentId_lessonId: { enrollmentId, lessonId } },
      update: { completedAt },
      create: { enrollmentId, lessonId, completedAt },
    });
    await refreshEnrollment(tx, enrollment, enrollment.courseId);
  });
}
