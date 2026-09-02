"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireCourseManager } from "@/lib/course-access";
import { db } from "@/lib/db";
import { eligibleTeacherWhere } from "@/lib/teacher-eligibility";

type ActionState = { message?: string };

const nameSchema = z.string().trim().min(1, "Give the classroom a name.").max(80);

function revalidateCourse(courseId: string) {
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/teacher/courses/${courseId}`);
  revalidatePath("/teacher/courses");
}

/**
 * Assigning a teacher to a classroom must also grant them CourseTeacher.
 *
 * CourseTeacher is what requireCourseManager checks — without a row there, a
 * classroom teacher cannot open the course at all and their own classroom is
 * unreachable. The two are deliberately separate concepts (manage the course
 * vs teach a room), so this bridges them rather than merging them.
 */
async function grantCourseAccess(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], courseId: string, userId: string) {
  await tx.courseTeacher.upsert({
    where: { courseId_userId: { courseId, userId } },
    update: {},
    create: { courseId, userId },
  });
}

async function assertEligibleTeacher(userId: string) {
  const count = await db.user.count({ where: eligibleTeacherWhere([userId]) });
  return count === 1;
}

export async function createClassroom(_: ActionState, formData: FormData): Promise<ActionState> {
  const courseId = String(formData.get("courseId") ?? "");
  const actor = await requireCourseManager(courseId);
  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!parsed.success) return { message: parsed.error.issues[0].message };
  const name = parsed.data;
  const teacherUserId = String(formData.get("teacherUserId") ?? "").trim() || null;

  if (teacherUserId && !await assertEligibleTeacher(teacherUserId)) {
    return { message: "That teacher is not eligible for this course." };
  }
  if (await db.classroom.findFirst({ where: { courseId, name } })) {
    return { message: `A classroom called "${name}" already exists on this course.` };
  }

  const classroom = await db.$transaction(async (tx) => {
    const created = await tx.classroom.create({ data: { courseId, name, teacherUserId } });
    if (teacherUserId) await grantCourseAccess(tx, courseId, teacherUserId);
    return created;
  });
  await audit(actor.id, "CLASSROOM_CREATED", "Classroom", classroom.id, { courseId, name, teacherUserId });
  revalidateCourse(courseId);
  return { message: `Classroom "${name}" created.` };
}

export async function updateClassroom(_: ActionState, formData: FormData): Promise<ActionState> {
  const classroomId = String(formData.get("classroomId") ?? "");
  const classroom = await db.classroom.findUnique({ where: { id: classroomId } });
  if (!classroom) return { message: "Classroom not found." };
  const actor = await requireCourseManager(classroom.courseId);

  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!parsed.success) return { message: parsed.error.issues[0].message };
  const name = parsed.data;
  const teacherUserId = String(formData.get("teacherUserId") ?? "").trim() || null;

  if (teacherUserId && !await assertEligibleTeacher(teacherUserId)) {
    return { message: "That teacher is not eligible for this course." };
  }
  const clash = await db.classroom.findFirst({ where: { courseId: classroom.courseId, name, id: { not: classroomId } } });
  if (clash) return { message: `A classroom called "${name}" already exists on this course.` };

  await db.$transaction(async (tx) => {
    await tx.classroom.update({ where: { id: classroomId }, data: { name, teacherUserId } });
    if (teacherUserId) await grantCourseAccess(tx, classroom.courseId, teacherUserId);
  });
  // The previous teacher keeps their CourseTeacher row on purpose. It may be
  // the only thing giving them access to another classroom on the same course,
  // and revoking course access is a separate, deliberate act.
  await audit(actor.id, "CLASSROOM_UPDATED", "Classroom", classroomId, { name, teacherUserId });
  revalidateCourse(classroom.courseId);
  return { message: `Classroom "${name}" updated.` };
}

/**
 * Deleting a classroom does NOT touch enrolments — the FK is SET NULL, so its
 * learners fall back to unassigned, keeping all their progress, attempts and
 * feedback. Refused while it still holds learners so that never happens by
 * accident: empty it first, which forces the choice of where they go.
 */
export async function deleteClassroom(_: ActionState, formData: FormData): Promise<ActionState> {
  const classroomId = String(formData.get("classroomId") ?? "");
  const classroom = await db.classroom.findUnique({
    where: { id: classroomId },
    include: { _count: { select: { enrollments: true } } },
  });
  if (!classroom) return { message: "Classroom not found." };
  const actor = await requireCourseManager(classroom.courseId);
  if (classroom._count.enrollments > 0) {
    return { message: `"${classroom.name}" still has ${classroom._count.enrollments} learner(s). Move them out first.` };
  }
  await db.classroom.delete({ where: { id: classroomId } });
  await audit(actor.id, "CLASSROOM_DELETED", "Classroom", classroomId, { courseId: classroom.courseId, name: classroom.name });
  revalidateCourse(classroom.courseId);
  return { message: `Classroom "${classroom.name}" deleted.` };
}

/**
 * Move the selected learners into a classroom, or out of one when the target is
 * blank. Enrolments are matched on courseId too, so a stray id from another
 * course cannot be dragged in.
 */
export async function assignLearnersToClassroom(_: ActionState, formData: FormData): Promise<ActionState> {
  const courseId = String(formData.get("courseId") ?? "");
  const actor = await requireCourseManager(courseId);
  const classroomId = String(formData.get("classroomId") ?? "").trim() || null;
  const enrollmentIds = formData.getAll("enrollmentIds").map(String).filter(Boolean);
  if (!enrollmentIds.length) return { message: "Select at least one learner." };

  if (classroomId) {
    const classroom = await db.classroom.findFirst({ where: { id: classroomId, courseId } });
    if (!classroom) return { message: "That classroom is not on this course." };
  }

  const result = await db.enrollment.updateMany({
    where: { id: { in: enrollmentIds }, courseId },
    data: { classroomId },
  });
  await audit(actor.id, "CLASSROOM_LEARNERS_ASSIGNED", "Course", courseId, { classroomId, count: result.count });
  revalidateCourse(courseId);
  return {
    message: classroomId
      ? `${result.count} learner(s) moved.`
      : `${result.count} learner(s) removed from their classroom.`,
  };
}
