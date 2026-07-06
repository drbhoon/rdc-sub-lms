import { Prisma, UserRole } from "@prisma/client";

export function eligibleTeacherWhere(userIds?: string[]): Prisma.UserWhereInput {
  return {
    ...(userIds ? { id: { in: userIds } } : {}),
    roles: { some: { role: UserRole.TEACHER } },
    OR: [
      { employee: { status: "ACTIVE" } },
      { AND: [{ employeeId: null }, { roles: { some: { role: UserRole.SUPER_ADMIN } } }] },
    ],
  };
}
