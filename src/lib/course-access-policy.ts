import { UserRole } from "@prisma/client";

export function canManageCourse(roles: UserRole[], isAssignedTeacher: boolean) {
  return roles.includes(UserRole.SUPER_ADMIN) || isAssignedTeacher;
}
