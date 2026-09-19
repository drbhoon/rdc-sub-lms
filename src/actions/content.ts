"use server";

import { CourseStatus, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { requireRole } from "@/lib/session";

export async function retryContent(formData: FormData) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const contentId = String(formData.get("contentId"));
  const content = await db.courseContent.findUniqueOrThrow({ where: { id: contentId }, include: { jobs: { orderBy: { createdAt: "desc" }, take: 1 } } });
  const job = content.jobs[0];
  if (content.processingStatus !== "FAILED" || !job || job.attempts >= 3) throw new Error("This upload cannot be retried again");
  await db.$transaction([
    db.processingJob.update({ where: { id: job.id }, data: { status: "QUEUED", error: null, lockedAt: null } }),
    db.courseContent.update({ where: { id: content.id }, data: { processingStatus: "QUEUED", processingError: null } }),
  ]);
  await audit(actor.id, "CONTENT_RETRIED", "CourseContent", content.id, { attempt: job.attempts + 1 });
  revalidatePath(`/admin/courses/${content.courseId}`);
}

export async function deleteCourseContent(_: { message?: string }, formData: FormData) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const contentId = String(formData.get("contentId") ?? "");
  if (formData.get("confirmDelete") !== "on") return { message: "Tick the confirmation box before deleting course content." };
  const content = await db.courseContent.findUnique({
    where: { id: contentId },
    include: { course: { select: { status: true } }, lessons: { select: { pageAssetKeys: true } } },
  });
  if (!content) return { message: "Course content not found." };
  const storedKeys = new Set<string>([content.storedKey]);
  for (const lesson of content.lessons) {
    if (Array.isArray(lesson.pageAssetKeys)) {
      for (const key of lesson.pageAssetKeys) if (typeof key === "string") storedKeys.add(key);
    }
  }

  await db.$transaction(async (tx) => {
    await tx.courseContent.delete({ where: { id: contentId } });
    const remaining = await tx.courseContent.findMany({
      where: { courseId: content.courseId },
      select: { isPublished: true, rejectedAt: true, processingStatus: true, approvedAt: true, lessons: { select: { approvedAt: true } } },
    });
    const activeRemaining = remaining.filter((item) => !item.rejectedAt);
    const publishedRemaining = activeRemaining.some((item) => item.isPublished);
    if (!activeRemaining.length) {
      await tx.course.update({
        where: { id: content.courseId },
        data: { status: CourseStatus.DRAFT, hasPendingChanges: false, publishedAt: null },
      });
    } else if (content.course.status === CourseStatus.PUBLISHED && !publishedRemaining) {
      const processing = activeRemaining.some((item) => item.processingStatus === "QUEUED" || item.processingStatus === "PROCESSING");
      const readyForPublishing = activeRemaining.every((item) => item.processingStatus === "COMPLETED" && item.approvedAt && item.lessons.every((lesson) => lesson.approvedAt));
      await tx.course.update({
        where: { id: content.courseId },
        data: {
          status: processing ? CourseStatus.AI_PROCESSING : readyForPublishing ? CourseStatus.PENDING_TEACHER_APPROVAL : CourseStatus.CONTENT_UPLOADED,
          hasPendingChanges: true,
          publishedAt: null,
        },
      });
    } else {
      await tx.course.update({
        where: { id: content.courseId },
        data: { hasPendingChanges: activeRemaining.some((item) => !item.isPublished) },
      });
    }
  });
  await audit(actor.id, "CONTENT_DELETED", "CourseContent", contentId, { fileName: content.originalName, wasPublished: content.isPublished });
  await Promise.allSettled([...storedKeys].map((key) => storage.delete(key)));
  revalidatePath("/", "layout");
  return { message: `${content.originalName} was deleted.` };
}
