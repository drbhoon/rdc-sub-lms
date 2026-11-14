import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { canBuildCourse, canManageCourse } from "@/lib/course-access-policy";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** Setting up a course: a Super Admin, an Admin, or a teacher assigned to it. Not approval; that is requireCourseManager. */
export async function requireCourseBuilder(courseId: string) {
  const user = await requireUser();
  const roles = user.roles.map((grant) => grant.role);
  if (roles.includes(UserRole.SUPER_ADMIN) || roles.includes(UserRole.ADMIN)) return user;
  const assignment = await db.courseTeacher.findUnique({ where: { courseId_userId: { courseId, userId: user.id } } });
  if (!canBuildCourse(roles, Boolean(assignment))) redirect("/unauthorized");
  return user;
}

export async function requireCourseManager(courseId: string) {
  const user = await requireUser();
  const roles = user.roles.map((grant) => grant.role);
  if (roles.includes(UserRole.SUPER_ADMIN)) return user;
  const assignment = await db.courseTeacher.findUnique({ where: { courseId_userId: { courseId, userId: user.id } } });
  if (!canManageCourse(roles, Boolean(assignment))) redirect("/unauthorized");
  return user;
}
