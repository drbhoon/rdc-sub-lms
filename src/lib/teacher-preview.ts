import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * A teacher is enrolled on every course they teach, so they can open it the way
 * a learner does. That enrolment is flagged `isTeacherPreview`, and it is not a
 * learner: every count, roster, topper list, report, result and reminder asks
 * for learners with these fragments, so none of them can forget to leave the
 * teachers out.
 */

/** Where-fragment for Enrollment: real learners only. */
export const learnersOnly = { isTeacherPreview: false } satisfies Prisma.EnrollmentWhereInput;

/**
 * Where-fragment for AssessmentAttempt: not a teacher's practice attempt.
 * Written as NOT(is preview) rather than "is a learner" so that an attempt
 * whose enrolment was later removed — its link is cleared, not the attempt —
 * still counts: that person was a learner and their result stands.
 */
export const notTeacherAttempt = { NOT: { enrollment: { is: { isTeacherPreview: true } } } } satisfies Prisma.AssessmentAttemptWhereInput;

/**
 * Give these teachers a preview enrolment on the course, unless they already
 * have an enrolment (then it is left exactly as it is — a teacher who was put
 * on the roster as a real learner stays one). Sends no e-mail: nobody has asked
 * the teacher to take the course.
 *
 * Meant for teachers NEWLY assigned. Calling it for every teacher on every
 * save would quietly put back a preview an admin had removed.
 */
export async function enrolTeachersAsPreview(courseId: string, userIds: string[], client: Prisma.TransactionClient = db): Promise<number> {
  if (!userIds.length) return 0;
  const users = await client.user.findMany({
    where: { id: { in: userIds }, employee: { status: "ACTIVE" } },
    select: { employeeId: true },
  });
  const employeeIds = users.flatMap((user) => (user.employeeId ? [user.employeeId] : []));
  if (!employeeIds.length) return 0;
  const result = await client.enrollment.createMany({
    data: employeeIds.map((employeeId) => ({ employeeId, courseId, isTeacherPreview: true })),
    skipDuplicates: true,
  });
  return result.count;
}
