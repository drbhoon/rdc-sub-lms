"use server";

import { UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { requireRole } from "@/lib/session";
import { validateUpload } from "@/lib/uploads";

export async function uploadContent(_: { message?: string }, formData: FormData) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const courseId = String(formData.get("courseId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File)) return { message: "Select a content file." };
  const course = await db.course.findUnique({ where: { id: courseId }, include: { _count: { select: { contents: true } } } });
  if (!course || course.status === "ARCHIVED") return { message: "Course is unavailable." };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const validated = validateUpload(file, bytes);
    await storage.put(validated.key, bytes);
    const content = await db.courseContent.create({
      data: {
        courseId, version: course._count.contents + 1, originalName: file.name, storedKey: validated.key,
        mimeType: file.type, sizeBytes: file.size, type: validated.type, jobs: { create: {} },
      },
    });
    await db.course.update({ where: { id: courseId }, data: { status: course.status === "PUBLISHED" ? "PUBLISHED" : "CONTENT_UPLOADED", hasPendingChanges: true } });
    await audit(actor.id, "CONTENT_UPLOADED", "CourseContent", content.id, { fileName: file.name, size: file.size });
    revalidatePath(`/admin/courses/${courseId}`);
    return { message: "Upload queued for processing." };
  } catch (error) { return { message: error instanceof Error ? error.message : "Upload failed." }; }
}

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
