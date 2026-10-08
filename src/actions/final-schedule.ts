"use server";

import { UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { activeFinalAssessment, loadFinalAttempts, NO_CLASSROOM } from "@/lib/final-schedule";
import { afterAllowing } from "@/lib/final-sitting";
import { formatIst, parseIstLocal } from "@/lib/ist";
import { requireRole } from "@/lib/session";

type ActionState = { message?: string; ok?: boolean };

function refresh(courseId: string) {
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/admin/courses/${courseId}/final`);
  revalidatePath(`/learn/courses/${courseId}`);
}

const scopes = (formData: FormData) => [...new Set(formData.getAll("scope").map(String).filter(Boolean))];

/**
 * Schedule the final assessment for the classrooms ticked, all at once.
 *
 * Until a classroom is scheduled nobody in it can start the final: it no longer
 * opens by itself. The times typed are India time. The closing time is
 * optional; without one the window stays open. "No classroom" schedules the
 * learners who have not been placed in a classroom.
 */
export async function scheduleFinal(_: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const courseId = String(formData.get("courseId") ?? "");
  const picked = scopes(formData);
  if (!picked.length) return { message: "Tick at least one classroom to schedule." };

  const opensAt = parseIstLocal(String(formData.get("opensAt") ?? ""));
  if (!opensAt) return { message: "Enter the date and time the final opens." };
  const closesRaw = String(formData.get("closesAt") ?? "").trim();
  const closesAt = closesRaw ? parseIstLocal(closesRaw) : null;
  if (closesRaw && !closesAt) return { message: "The closing date and time could not be read." };
  if (closesAt && closesAt <= opensAt) return { message: "The final must close after it opens." };

  const classroomIds = picked.filter((key) => key !== NO_CLASSROOM);
  if (classroomIds.length) {
    const found = await db.classroom.count({ where: { courseId, id: { in: classroomIds } } });
    if (found !== classroomIds.length) return { message: "One of those classrooms does not belong to this course." };
  }

  await db.$transaction(async (tx) => {
    for (const classroomId of classroomIds) {
      await tx.finalAssessmentSchedule.upsert({
        where: { courseId_classroomId: { courseId, classroomId } },
        update: { opensAt, closesAt },
        create: { courseId, classroomId, opensAt, closesAt },
      });
    }
    if (picked.includes(NO_CLASSROOM)) {
      // NULL is never equal to NULL in a unique key, so this one row is kept
      // single here rather than by the database.
      const existing = await tx.finalAssessmentSchedule.findFirst({ where: { courseId, classroomId: null } });
      if (existing) await tx.finalAssessmentSchedule.update({ where: { id: existing.id }, data: { opensAt, closesAt } });
      else await tx.finalAssessmentSchedule.create({ data: { courseId, classroomId: null, opensAt, closesAt } });
    }
  });
  await audit(actor.id, "FINAL_SCHEDULED", "Course", courseId, {
    classrooms: picked.length, opensAt: opensAt.toISOString(), closesAt: closesAt?.toISOString() ?? null, scopes: picked,
  });
  refresh(courseId);
  return {
    ok: true,
    message: `${picked.length} classroom${picked.length === 1 ? "" : "s"} scheduled: opens ${formatIst(opensAt)}${closesAt ? `, closes ${formatIst(closesAt)}` : ""}.`,
  };
}

/** Take the schedule off the classrooms ticked: the final closes to them again. */
export async function clearFinalSchedule(_: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const courseId = String(formData.get("courseId") ?? "");
  const picked = scopes(formData);
  if (!picked.length) return { message: "Tick at least one classroom to clear." };

  const classroomIds = picked.filter((key) => key !== NO_CLASSROOM);
  const result = await db.finalAssessmentSchedule.deleteMany({
    where: {
      courseId,
      OR: [
        ...(classroomIds.length ? [{ classroomId: { in: classroomIds } }] : []),
        ...(picked.includes(NO_CLASSROOM) ? [{ classroomId: null }] : []),
      ],
    },
  });
  await audit(actor.id, "FINAL_SCHEDULE_CLEARED", "Course", courseId, { cleared: result.count, scopes: picked });
  refresh(courseId);
  return { ok: true, message: result.count ? `${result.count} schedule${result.count === 1 ? "" : "s"} cleared.` : "None of those had a schedule." };
}

/**
 * Let one learner sit the final again, or sit it outside their class's window.
 *
 * Gives exactly one more attempt than they have used (see afterAllowing), and
 * lets them in whatever the schedule says. Each attempt counts from the moment
 * it is started, so this is the only way past "one attempt".
 */
export async function allowFinalAttempt(formData: FormData): Promise<void> {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const enrollmentId = String(formData.get("enrollmentId") ?? "");
  const enrollment = await db.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, courseId: true, employeeId: true, finalAttemptsAllowed: true, employee: { select: { name: true, employeeCode: true } } },
  });
  if (!enrollment) return;
  const final = await activeFinalAssessment(enrollment.courseId);
  if (!final) return;

  const attempts = await loadFinalAttempts(final.id, final.timeLimitSeconds, [enrollment.employeeId]);
  const used = attempts.get(enrollment.employeeId)?.used ?? 0;
  const next = afterAllowing({ attemptsUsed: used, attemptsAllowed: enrollment.finalAttemptsAllowed });
  await db.enrollment.update({
    where: { id: enrollment.id },
    data: { finalAttemptsAllowed: next.attemptsAllowed, finalAdminOpened: next.adminOpened },
  });
  await audit(actor.id, "FINAL_ATTEMPT_ALLOWED", "Enrollment", enrollment.id, {
    courseId: enrollment.courseId, employeeCode: enrollment.employee.employeeCode, name: enrollment.employee.name,
    attemptsUsed: used, attemptsAllowed: next.attemptsAllowed,
  });
  refresh(enrollment.courseId);
}
