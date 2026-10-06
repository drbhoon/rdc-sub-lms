"use server";

import { UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

type ActionState = { message?: string; ok?: boolean };

/**
 * Take learners off a course: someone who is not attending, or has left.
 *
 * Admin only. This is a real removal, not a flag, and it is said so on the
 * screen before it is done:
 *  - their lesson progress on THIS course is deleted with the enrolment;
 *  - their quiz results are kept (an attempt belongs to the person, and only
 *    its link to the enrolment is cleared), so reports and certificates already
 *    earned are not rewritten;
 *  - their feedback responses are kept for the same reason;
 *  - they no longer count as a learner, appear in rosters, or get reminders.
 * Enrolling them again later starts a fresh enrolment.
 *
 * What was removed is written to the audit log by name, because once the rows
 * are gone that is the only record of who was on the course.
 */
export async function unenrolLearners(_: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const courseId = String(formData.get("courseId") ?? "");
  const enrollmentIds = [...new Set(formData.getAll("enrollmentId").map(String).filter(Boolean))];
  if (!enrollmentIds.length) return { message: "Tick at least one learner to remove." };
  if (formData.get("confirmRemove") !== "on") return { message: "Tick the confirmation box before removing." };

  // Scoped to the course, so an id from another course in a doctored form is ignored.
  const rows = await db.enrollment.findMany({
    where: { id: { in: enrollmentIds }, courseId },
    include: {
      employee: { select: { employeeCode: true, name: true } },
      progress: { select: { completedAt: true } },
      _count: { select: { assessmentAttempts: true } },
    },
  });
  if (!rows.length) return { message: "Those learners are no longer enrolled on this course." };

  await db.enrollment.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
  await audit(actor.id, "LEARNERS_UNENROLLED", "Course", courseId, {
    count: rows.length,
    learners: rows.map((row) => ({
      employeeCode: row.employee.employeeCode,
      name: row.employee.name,
      status: row.status,
      lessonsCompleted: row.progress.filter((item) => item.completedAt).length,
      quizAttempts: row._count.assessmentAttempts,
      teacherPreview: row.isTeacherPreview,
    })),
  });

  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/admin/courses/${courseId}/learners`);
  revalidatePath("/teacher/courses");
  revalidatePath(`/teacher/courses/${courseId}`);
  revalidatePath("/admin/reports", "layout");
  const skipped = enrollmentIds.length - rows.length;
  return { ok: true, message: `${rows.length} removed from the course.${skipped ? ` ${skipped} had already been removed.` : ""}` };
}
