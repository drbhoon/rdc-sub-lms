"use server";

import { revalidatePath } from "next/cache";
import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/session";
import { hasAnyEffectiveRole } from "@/lib/roles";
import { openScormAttempt, resetScormAttempts, type ScormLaunch } from "@/lib/scorm-attempts";

async function isManager(user: Awaited<ReturnType<typeof requireUser>>, courseId: string) {
  if (user.roles.some((grant) => grant.role === UserRole.SUPER_ADMIN)) return true;
  return Boolean(await db.courseTeacher.findUnique({ where: { courseId_userId: { courseId, userId: user.id } } }));
}

/** Start, resume, retry or review a SCORM lesson. Managers get a preview that records nothing. */
export async function launchScorm(lessonId: string): Promise<ScormLaunch | { locked: true } | { error: string }> {
  const user = await requireUser();
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, include: { content: { include: { course: true } } } });
  if (!lesson || lesson.type !== "SCORM") return { error: "This lesson is not a SCORM course." };
  const courseId = lesson.content.courseId;
  const learner = { employeeCode: user.employee?.employeeCode ?? user.email, name: user.employee?.name ?? user.email };

  const enrollment = user.employeeId
    ? await db.enrollment.findUnique({ where: { employeeId_courseId: { employeeId: user.employeeId, courseId } } })
    : null;
  if (!enrollment) {
    if (!(await isManager(user, courseId))) return { error: "You are not enrolled in this course." };
    return openScormAttempt({ lesson, learner, enrollmentId: null });
  }
  if (lesson.content.course.status !== "PUBLISHED" || !lesson.content.isPublished || !lesson.approvedAt) return { error: "This lesson is not available yet." };
  const launch = await openScormAttempt({ lesson, learner, enrollmentId: enrollment.id });
  if (!("locked" in launch) && launch.attemptId) {
    await db.enrollment.updateMany({ where: { id: enrollment.id, status: "NOT_STARTED" }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
  }
  return launch;
}

/** Admin or the course's teacher gives a learner two new attempts. */
export async function resetScormForLearner(enrollmentId: string, lessonId: string) {
  const user = await requireUser();
  const enrollment = await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId }, include: { employee: true } });
  if (!hasAnyEffectiveRole(user, [UserRole.SUPER_ADMIN]) && !(await isManager(user, enrollment.courseId))) throw new Error("Not allowed");
  const count = await resetScormAttempts(enrollmentId, lessonId);
  await audit(user.id, "SCORM_ATTEMPTS_RESET", "Enrollment", enrollmentId, { lessonId, employee: enrollment.employee.employeeCode, attempts: count });
  revalidatePath(`/admin/courses/${enrollment.courseId}`);
  revalidatePath(`/learn/courses/${enrollment.courseId}`);
  return { reset: count };
}
