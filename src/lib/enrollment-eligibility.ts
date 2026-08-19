import { Prisma } from "@prisma/client";

/**
 * Who an admin may enrol on a course: any ACTIVE employee.
 *
 * Company used to gate this — a course offered only employees belonging to a
 * company linked to it. Dr Bhoon's decision (2026-08-19): every employee,
 * on-roll and off-roll alike, is eligible for any course, and the admin
 * chooses. The gate cost far more than it bought.
 *
 * It was silently exclusive. "RDC Concrete (India) Limited" and "RDC Concrete
 * India Ltd." are the same firm, and because they were two rows, 816 employees
 * sat in one while all six courses pointed at the other — which held a single
 * person. The enrolment picker showed nobody but Super Admins, who were exempt,
 * and gave no hint why. Every new feed and every spelling variation was another
 * chance to reproduce that, silently.
 *
 * Status still matters: a leaver should not be enrolled on anything.
 */
export function eligibleLearnerForCourseWhere(employeeIds?: string[]): Prisma.EmployeeWhereInput {
  return {
    ...(employeeIds ? { id: { in: employeeIds } } : {}),
    status: "ACTIVE",
  };
}
