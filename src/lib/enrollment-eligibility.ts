import { Prisma, UserRole } from "@prisma/client";

export function eligibleLearnerForCourseWhere(courseCompanyIds: string[], employeeIds?: string[]): Prisma.EmployeeWhereInput {
  return {
    ...(employeeIds ? { id: { in: employeeIds } } : {}),
    status: "ACTIVE",
    OR: [
      { companyId: { in: courseCompanyIds } },
      { user: { is: { roles: { some: { role: UserRole.SUPER_ADMIN } } } } },
    ],
  };
}
