import { UserRole } from "@prisma/client";

type RoleBearingUser = {
  roles: Array<{ role: UserRole }>;
} | null | undefined;

export function hasEffectiveRole(user: RoleBearingUser, role: UserRole) {
  if (!user) return false;
  const roles = new Set(user.roles.map((grant) => grant.role));
  if (roles.has(role)) return true;
  // A Super Admin can do everything below them. An Admin is NOT a teacher: approving content is the teacher's job.
  return roles.has(UserRole.SUPER_ADMIN) && (role === UserRole.ADMIN || role === UserRole.TEACHER || role === UserRole.LEARNER);
}

export function hasAnyEffectiveRole(user: RoleBearingUser, allowed: UserRole[]) {
  return allowed.some((role) => hasEffectiveRole(user, role));
}
