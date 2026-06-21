import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export async function requireCourseManager(courseId: string) {
  const user = await requireUser();
  if (user.roles.some((r) => r.role === UserRole.SUPER_ADMIN)) return user;
  const assignment = await db.courseTeacher.findUnique({ where: { courseId_userId: { courseId, userId: user.id } } });
  if (!assignment) throw new Error("You are not assigned to this course");
  return user;
}
