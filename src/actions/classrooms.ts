"use server";

import { CourseStatus, EmployeeStatus, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { queueTeacherRoleEmails } from "@/lib/course-notifications";
import { classroomKey, hasClassroomColumns, planClassrooms } from "@/lib/classroom-import";
import { requireCourseManager } from "@/lib/course-access";
import { db } from "@/lib/db";
import { enrolRoster, queueEnrollmentEmails } from "@/lib/roster-enrolment";
import { requireRole } from "@/lib/session";
import { readTabularFile } from "@/lib/tabular-import";
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

export type ClassroomImportState = { message?: string; details?: string[]; ok?: boolean };

const MAX_LISTED = 12;

function refused(summary: string, problems: string[]): ClassroomImportState {
  return {
    message: `${summary} Nothing was changed.`,
    details: problems.length > MAX_LISTED ? [...problems.slice(0, MAX_LISTED), `…and ${problems.length - MAX_LISTED} more.`] : problems,
  };
}

/**
 * Set up a course's classrooms from one file: create the rooms, give each its
 * teacher, enrol any learner not yet on the course (admitting new people the
 * same way the roster upload does), and place every learner in their room.
 *
 * The file is checked in full before anything is written — see
 * planClassrooms — and so are the teachers, so a file either applies or comes
 * back with the complete list of what to fix.
 *
 * What the file does NOT touch: rooms it does not mention, learners it does
 * not list, and the teacher of a room it lists without one. A listed learner
 * who already sits in another room is moved, because the file says where they
 * belong.
 *
 * Naming someone in the teacher column gives them the Teacher role if they
 * lack it — the admin has just said they teach. They must already be an
 * active employee in LMS: this upload never invents a teacher from a bare
 * e-mail address.
 */
export async function importClassrooms(_: ClassroomImportState, formData: FormData): Promise<ClassroomImportState> {
  const courseId = String(formData.get("courseId") ?? "");
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course) return { message: "Course not found." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { message: "Select the classroom CSV or Excel file." };
  let rawRows: Awaited<ReturnType<typeof readTabularFile>>;
  try {
    rawRows = await readTabularFile(file);
  } catch (error) {
    return { message: error instanceof Error ? error.message : "The classroom file could not be read." };
  }
  if (!rawRows.length) return { message: "The classroom file is empty." };
  if (!hasClassroomColumns(rawRows[0])) return { message: "The file needs CLASSROOM and LEARNER_EMAIL columns. Download the template for the layout." };

  const plan = planClassrooms(rawRows);

  // ── Teachers: each must be an active person already in LMS ──────────────
  const teacherEmails = [...new Set(plan.classrooms.map((room) => room.teacherEmail).filter((email): email is string => Boolean(email)))];
  const teacherUsers = teacherEmails.length ? await db.user.findMany({
    where: { OR: [{ email: { in: teacherEmails } }, { employee: { email: { in: teacherEmails } } }] },
    include: { employee: true, roles: true },
  }) : [];
  const teacherByEmail = new Map<string, (typeof teacherUsers)[number]>();
  for (const user of teacherUsers) {
    teacherByEmail.set(user.email.toLowerCase(), user);
    if (user.employee) teacherByEmail.set(user.employee.email.toLowerCase(), user);
  }
  const teacherProblems: string[] = [];
  const needsTeacherRole = new Set<string>();
  for (const email of teacherEmails) {
    const user = teacherByEmail.get(email);
    const roles = new Set(user?.roles.map((grant) => grant.role) ?? []);
    if (!user) teacherProblems.push(`Teacher ${email} is not in LMS. Add them as an employee first.`);
    else if (user.employee && user.employee.status !== EmployeeStatus.ACTIVE) teacherProblems.push(`Teacher ${email} is not an active employee.`);
    else if (!user.employee && !roles.has(UserRole.SUPER_ADMIN)) teacherProblems.push(`Teacher ${email} has a login but no employee record.`);
    else if (!roles.has(UserRole.TEACHER) && !roles.has(UserRole.SUPER_ADMIN)) needsTeacherRole.add(user.id);
  }
  // File problems and teacher problems come back together, so one round of
  // corrections fixes everything rather than revealing the next layer.
  const problems = [...plan.errors, ...teacherProblems];
  if (problems.length) return refused(`The file has ${problems.length} problem(s).`, problems);

  // ── Learners: new enrolments need a course that accepts them ─────────────
  const learnerEmails = plan.learners.map((learner) => learner.email);
  const alreadyEnrolled = learnerEmails.length
    ? await db.enrollment.count({ where: { courseId, employee: { email: { in: learnerEmails } } } })
    : 0;
  const toEnrol = learnerEmails.length - alreadyEnrolled;
  if (toEnrol > 0 && course.status !== CourseStatus.PUBLISHED) {
    return refused(`${toEnrol} learner(s) in the file are not on this course yet, and learners can only be enrolled once it is published.`, []);
  }
  if (toEnrol > 0 && !course.isActive) {
    return refused(`${toEnrol} learner(s) in the file are not on this course yet, and it is inactive. Reactivate it first.`, []);
  }

  const enrolment = await enrolRoster(course, plan.learners);
  queueEnrollmentEmails(enrolment.newlyEnrolled, course);

  // ── Rooms, teachers and placements, in one transaction ───────────────────
  const existingRooms = await db.classroom.findMany({ where: { courseId } });
  const roomByKey = new Map(existingRooms.map((room) => [classroomKey(room.name), room]));
  const placedEmployeeIds = [...enrolment.employeeIdByEmail.values()];
  const before = placedEmployeeIds.length ? await db.enrollment.findMany({
    where: { courseId, employeeId: { in: placedEmployeeIds } },
    select: { employeeId: true, classroomId: true },
  }) : [];
  const roomBefore = new Map(before.map((enrollment) => [enrollment.employeeId, enrollment.classroomId]));

  let roomsCreated = 0;
  let roomsRetaught = 0;
  let placed = 0;
  let moved = 0;
  // 50 rooms is a few hundred statements; the 5 s default is too tight for that.
  await db.$transaction(async (tx) => {
    for (const userId of needsTeacherRole) {
      await tx.userRoleGrant.upsert({ where: { userId_role: { userId, role: UserRole.TEACHER } }, update: {}, create: { userId, role: UserRole.TEACHER } });
    }
    for (const planned of plan.classrooms) {
      const teacherUserId = planned.teacherEmail ? teacherByEmail.get(planned.teacherEmail)!.id : undefined;
      let room = roomByKey.get(classroomKey(planned.name));
      if (!room) {
        room = await tx.classroom.create({ data: { courseId, name: planned.name, teacherUserId: teacherUserId ?? null } });
        roomByKey.set(classroomKey(planned.name), room);
        roomsCreated += 1;
      } else if (teacherUserId && room.teacherUserId !== teacherUserId) {
        room = await tx.classroom.update({ where: { id: room.id }, data: { teacherUserId } });
        roomsRetaught += 1;
      }
      if (teacherUserId) await grantCourseAccess(tx, courseId, teacherUserId);

      const employeeIds = planned.learnerEmails
        .map((email) => enrolment.employeeIdByEmail.get(email))
        .filter((id): id is string => Boolean(id));
      if (!employeeIds.length) continue;
      const roomId = room.id;
      const result = await tx.enrollment.updateMany({ where: { courseId, employeeId: { in: employeeIds } }, data: { classroomId: roomId } });
      placed += result.count;
      moved += employeeIds.filter((id) => roomBefore.get(id) && roomBefore.get(id) !== roomId).length;
    }
  }, { timeout: 120_000 });
  // Only now that the grants are committed: a rolled-back upload must not
  // have told anybody they are a teacher.
  queueTeacherRoleEmails(needsTeacherRole);

  await audit(actor.id, "CLASSROOMS_IMPORTED", "Course", courseId, {
    fileName: file.name, rooms: plan.classrooms.length, roomsCreated, roomsRetaught, placed, moved,
    learnersCreated: enrolment.created, learnersEnrolled: enrolment.enrolled, teacherRolesGranted: needsTeacherRole.size,
    errors: enrolment.rowErrors.length,
  });
  revalidateCourse(courseId);
  revalidatePath("/admin/employees");

  const notes = [
    `${plan.classrooms.length} classroom(s) in the file: ${roomsCreated} created, ${plan.classrooms.length - roomsCreated} already existed${roomsRetaught ? ` (${roomsRetaught} given a new teacher)` : ""}`,
    `${placed} learner(s) placed${moved ? `, ${moved} of them moved from another classroom` : ""}`,
  ];
  if (enrolment.enrolled) notes.push(`${enrolment.enrolled} newly enrolled on the course${enrolment.created ? `, ${enrolment.created} of them new to LMS` : ""}; their enrolment e-mails are being sent`);
  if (needsTeacherRole.size) notes.push(`${needsTeacherRole.size} person(s) given the Teacher role and e-mailed a sign-in link`);
  return {
    ok: enrolment.rowErrors.length === 0,
    message: `Classrooms updated. ${notes.join("; ")}.`,
    details: enrolment.rowErrors.length
      ? [`${enrolment.rowErrors.length} learner(s) could not be enrolled, so were not placed:`, ...enrolment.rowErrors.slice(0, MAX_LISTED)]
      : undefined,
  };
}
