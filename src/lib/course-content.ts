import { Prisma, type ContentType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * Create a course's next content row.
 *
 * The number is one past the highest ALREADY USED, not a count of the rows
 * there are. It was a count, so as soon as any module was deleted (leaving
 * versions 1 and 3, say) the next upload computed 2+1 = 3, collided with the
 * unique (courseId, version) key and failed with "Unique constraint failed".
 * A second upload at the same moment can still claim the number first, so a
 * collision is retried with a fresh look rather than shown to the teacher.
 */
export async function createContentWithNextVersion(data: Omit<Prisma.CourseContentUncheckedCreateInput, "version">) {
  for (let attempt = 1; ; attempt += 1) {
    const latest = await db.courseContent.aggregate({ where: { courseId: data.courseId }, _max: { version: true } });
    try {
      return await db.courseContent.create({ data: { ...data, version: (latest._max.version ?? 0) + 1 } });
    } catch (error) {
      const taken = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!taken || attempt >= 5) throw error;
    }
  }
}

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
  const course = await db.course.findUniqueOrThrow({ where: { id: input.courseId } });
  const content = await createContentWithNextVersion({
    courseId: input.courseId, originalName: input.fileName, storedKey: input.storedKey,
    mimeType: input.mimeType, sizeBytes: input.sizeBytes, type: input.type, jobs: { create: {} },
  });
  await db.course.update({ where: { id: input.courseId }, data: { status: course.status === "PUBLISHED" ? "PUBLISHED" : "CONTENT_UPLOADED", hasPendingChanges: true } });
  await audit(input.actorId, "CONTENT_UPLOADED", "CourseContent", content.id, { fileName: input.fileName, size: input.sizeBytes });
  revalidatePath(`/admin/courses/${input.courseId}`);
  return content;
}
