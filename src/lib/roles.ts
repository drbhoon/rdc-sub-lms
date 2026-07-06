import { UserRole } from "@prisma/client";

type RoleBearingUser = {
  roles: Array<{ role: UserRole }>;
} | null | undefined;

export function hasEffectiveRole(user: RoleBearingUser, role: UserRole) {
  if (!user) return false;
  const roles = new Set(user.roles.map((grant) => grant.role));
  if (roles.has(role)) return true;
  return roles.has(UserRole.SUPER_ADMIN) && (role === UserRole.TEACHER || role === UserRole.LEARNER);
}

export function hasAnyEffectiveRole(user: RoleBearingUser, allowed: UserRole[]) {
  return allowed.some((role) => hasEffectiveRole(user, role));
}
