import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { hasAnyEffectiveRole } from "@/lib/roles";
import { currentUser } from "@/lib/session";

export async function routeUserWithRole(...roles: UserRole[]) {
  const user = await currentUser();
  if (!user || !hasAnyEffectiveRole(user, roles)) return null;
  return user;
}

export async function routeCourseManager(courseId: string) {
  const user = await currentUser();
  if (!user) return null;
  if (user.roles.some((grant) => grant.role === UserRole.SUPER_ADMIN)) return user;
  const assignment = await db.courseTeacher.findUnique({ where: { courseId_userId: { courseId, userId: user.id } } });
  return assignment ? user : null;
}
