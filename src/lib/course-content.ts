import type { ContentType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * Record a stored file as the course's next content version and queue it for
 * processing. The course moves to CONTENT_UPLOADED unless it is already
 * published, in which case learners keep the current version until the new
 * one is approved and published.
 */
export async function recordCourseContent(input: {
  actorId: string;
  courseId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storedKey: string;
  type: ContentType;
}) {
  const course = await db.course.findUniqueOrThrow({ where: { id: input.courseId }, include: { _count: { select: { contents: true } } } });
  const content = await db.courseContent.create({
    data: {
      courseId: input.courseId, version: course._count.contents + 1, originalName: input.fileName, storedKey: input.storedKey,
      mimeType: input.mimeType, sizeBytes: input.sizeBytes, type: input.type, jobs: { create: {} },
    },
  });
  await db.course.update({ where: { id: input.courseId }, data: { status: course.status === "PUBLISHED" ? "PUBLISHED" : "CONTENT_UPLOADED", hasPendingChanges: true } });
  await audit(input.actorId, "CONTENT_UPLOADED", "CourseContent", content.id, { fileName: input.fileName, size: input.sizeBytes });
  revalidatePath(`/admin/courses/${input.courseId}`);
  return content;
}
