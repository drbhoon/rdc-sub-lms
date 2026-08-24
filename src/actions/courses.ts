"use server";

import { EmployeeStatus, CourseStatus, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { normaliseCompany } from "@/lib/company-merge";
import { requireCourseManager } from "@/lib/course-access";
import { hasEmailColumn, internEmployeeCode, nameFromEmail, parseCourseEnrollmentRow } from "@/lib/course-enrollment-import";
import { sendEnrollmentEmail } from "@/lib/course-notifications";
import { db } from "@/lib/db";
import { eligibleLearnerForCourseWhere } from "@/lib/enrollment-eligibility";
import { resolvePersonId } from "@/lib/identity";
import { requireRole } from "@/lib/session";
import { storage } from "@/lib/storage";
import { readTabularFile } from "@/lib/tabular-import";
import { eligibleTeacherWhere } from "@/lib/teacher-eligibility";

const courseSchema = z.object({
  title: z.string().trim().min(3).max(150),
  category: z.string().trim().min(2).max(80),
  description: z.string().trim().min(10).max(5000),
  durationMinutes: z.coerce.number().int().min(1).max(10000),
  passPercentage: z.coerce.number().int().min(1).max(100),
  aiTokenLimit: z.coerce.number().int().min(0).max(10_000_000),
});

function uniqueIds(values: FormDataEntryValue[]) {
  return [...new Set(values.map(String).filter(Boolean))];
}

export async function createCourse(_: { message?: string }, formData: FormData) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const parsed = courseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { message: parsed.error.issues[0].message };
  const companyIds = uniqueIds(formData.getAll("companyIds"));
  const teacherIds = uniqueIds([...formData.getAll("teacherIds"), ...(formData.get("teacherId") ? [formData.get("teacherId")!] : [])]);
  if (!companyIds.length) return { message: "Select at least one company." };
  if (teacherIds.length) {
    const teacherCount = await db.user.count({ where: eligibleTeacherWhere(teacherIds) });
    if (teacherCount !== teacherIds.length) return { message: "One or more selected teachers are not eligible." };
  }

  const course = await db.course.create({
    data: {
      ...parsed.data,
      certificateEnabled: formData.get("certificateEnabled") === "on",
      leaderboardEnabled: formData.get("leaderboardEnabled") === "on",
      companies: { create: companyIds.map((companyId) => ({ companyId })) },
      teachers: teacherIds.length ? { create: teacherIds.map((userId) => ({ userId })) } : undefined,
    },
  });
  await audit(actor.id, "COURSE_CREATED", "Course", course.id);
  redirect(`/admin/courses/${course.id}`);
}

export async function updateCourse(_: { message?: string }, formData: FormData) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const courseId = String(formData.get("courseId") ?? "");
  const parsed = courseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { message: parsed.error.issues[0].message };
  const companyIds = uniqueIds(formData.getAll("companyIds"));
  if (!companyIds.length) return { message: "Select at least one company." };

  const course = await db.course.findUnique({
    where: { id: courseId },
    include: { companies: true, enrollments: { include: { employee: true } } },
  });
  if (!course) return { message: "Course not found." };

  const selected = new Set(companyIds);
  const enrolledRemovedCompanies = course.enrollments.filter((enrollment) => !selected.has(enrollment.employee.companyId));
  if (enrolledRemovedCompanies.length) return { message: "Cannot remove a company that already has enrolled learners. Inactivate the course or keep the company assigned." };

  await db.$transaction(async (tx) => {
    await tx.course.update({
      where: { id: courseId },
      data: {
        ...parsed.data,
        certificateEnabled: formData.get("certificateEnabled") === "on",
        leaderboardEnabled: formData.get("leaderboardEnabled") === "on",
      },
    });
    await tx.courseCompany.deleteMany({ where: { courseId, companyId: { notIn: companyIds } } });
    for (const companyId of companyIds) {
      await tx.courseCompany.upsert({
        where: { courseId_companyId: { courseId, companyId } },
        update: {},
        create: { courseId, companyId },
      });
    }
  });

  await audit(actor.id, "COURSE_UPDATED", "Course", courseId);
  revalidatePath("/", "layout");
  return { message: "Course details updated." };
}

export async function updateCourseTeachers(_: { message?: string }, formData: FormData) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const courseId = String(formData.get("courseId") ?? "");
  const teacherIds = uniqueIds(formData.getAll("teacherIds"));
  const course = await db.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) return { message: "Course not found." };
  if (teacherIds.length) {
    const teacherCount = await db.user.count({ where: eligibleTeacherWhere(teacherIds) });
    if (teacherCount !== teacherIds.length) return { message: "One or more selected teachers are not eligible." };
  }
  await db.$transaction(async (tx) => {
    await tx.courseTeacher.deleteMany({ where: teacherIds.length ? { courseId, userId: { notIn: teacherIds } } : { courseId } });
    for (const userId of teacherIds) {
      await tx.courseTeacher.upsert({
        where: { courseId_userId: { courseId, userId } },
        update: {},
        create: { courseId, userId },
      });
    }
  });
  await audit(actor.id, "COURSE_TEACHERS_UPDATED", "Course", courseId, { teacherCount: teacherIds.length });
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/teacher/courses");
  return { message: teacherIds.length ? "Teacher assignment updated." : "All teachers removed. Super Admin can still manage this course." };
}

export async function setCourseActive(formData: FormData) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const courseId = String(formData.get("courseId") ?? "");
  const isActive = String(formData.get("isActive")) === "true";
  await db.course.update({ where: { id: courseId }, data: { isActive } });
  await audit(actor.id, isActive ? "COURSE_ACTIVATED" : "COURSE_INACTIVATED", "Course", courseId);
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/learn/courses");
  revalidatePath("/teacher/courses");
}

export async function setCourseStatus(formData: FormData) {
  const courseId = String(formData.get("courseId"));
  const status = String(formData.get("status")) as CourseStatus;
  const actor = await requireCourseManager(courseId);
  const course = await db.course.findUniqueOrThrow({ where: { id: courseId }, include: { contents: { include: { lessons: true } } } });
  const allowed: Partial<Record<CourseStatus, CourseStatus[]>> = {
    DRAFT: [CourseStatus.CONTENT_UPLOADED], CONTENT_UPLOADED: [CourseStatus.AI_PROCESSING, CourseStatus.PENDING_TEACHER_APPROVAL],
    AI_PROCESSING: [CourseStatus.PENDING_TEACHER_APPROVAL], PENDING_TEACHER_APPROVAL: [CourseStatus.PUBLISHED, CourseStatus.DRAFT],
    PUBLISHED: [CourseStatus.PUBLISHED, CourseStatus.ARCHIVED, CourseStatus.DRAFT], ARCHIVED: [CourseStatus.DRAFT],
  };
  if (!allowed[course.status]?.includes(status)) throw new Error(`Invalid course transition from ${course.status} to ${status}`);
  if (status === CourseStatus.PUBLISHED) {
    const activeContents = course.contents.filter((content) => !content.rejectedAt);
    const ready = activeContents.length > 0 && activeContents.every((content) => content.processingStatus === "COMPLETED" && content.approvedAt && content.lessons.every((lesson) => lesson.approvedAt));
    if (!ready) throw new Error("All content and lessons must be processed and approved before publishing");
  }
  await db.$transaction(async (tx) => {
    await tx.course.update({ where: { id: courseId }, data: { status, hasPendingChanges: status === CourseStatus.PUBLISHED ? false : course.hasPendingChanges, publishedAt: status === CourseStatus.PUBLISHED ? new Date() : course.publishedAt } });
    if (status === CourseStatus.PUBLISHED) await tx.courseContent.updateMany({ where: { courseId, approvedAt: { not: null }, rejectedAt: null }, data: { isPublished: true } });
  });
  await audit(actor.id, `COURSE_${status}`, "Course", courseId);
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/teacher/courses/${courseId}`);
}

export async function approveContent(formData: FormData) {
  const courseId = String(formData.get("courseId"));
  const contentId = String(formData.get("contentId"));
  const actor = await requireCourseManager(courseId);
  const content = await db.courseContent.findFirst({ where: { id: contentId, courseId, processingStatus: "COMPLETED" } });
  if (!content) throw new Error("Content is not ready for approval");
  const course = await db.course.findUniqueOrThrow({ where: { id: courseId }, select: { status: true } });
  await db.$transaction([
    db.courseContent.update({ where: { id: contentId }, data: { approvedAt: new Date(), rejectedAt: null, rejectionReason: null } }),
    db.lesson.updateMany({ where: { courseContentId: contentId }, data: { approvedAt: new Date() } }),
    db.course.update({ where: { id: courseId }, data: { status: course.status === CourseStatus.PUBLISHED ? CourseStatus.PUBLISHED : CourseStatus.PENDING_TEACHER_APPROVAL, hasPendingChanges: true } }),
  ]);
  await audit(actor.id, "CONTENT_APPROVED", "CourseContent", contentId);
  revalidatePath(`/teacher/courses/${courseId}`);
}

export async function rejectContent(formData: FormData) {
  const courseId = String(formData.get("courseId"));
  const contentId = String(formData.get("contentId"));
  const reason = String(formData.get("reason") ?? "").trim();
  const actor = await requireCourseManager(courseId);
  if (reason.length < 5 || reason.length > 500) throw new Error("Provide a rejection reason between 5 and 500 characters");
  const content = await db.courseContent.findFirst({ where: { id: contentId, courseId, isPublished: false } });
  if (!content) throw new Error("Published content cannot be rejected");
  await db.courseContent.update({ where: { id: contentId }, data: { rejectedAt: new Date(), rejectionReason: reason, approvedAt: null } });
  const remaining = await db.courseContent.count({ where: { courseId, isPublished: false, rejectedAt: null } });
  await db.course.update({ where: { id: courseId }, data: { hasPendingChanges: remaining > 0 } });
  await audit(actor.id, "CONTENT_REJECTED", "CourseContent", contentId, { reason });
  revalidatePath(`/teacher/courses/${courseId}`);
}

export async function editLesson(formData: FormData) {
  const courseId = String(formData.get("courseId"));
  const lessonId = String(formData.get("lessonId"));
  const actor = await requireCourseManager(courseId);
  const title = String(formData.get("title") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  if (title.length < 3 || title.length > 150 || summary.length > 5000) throw new Error("Lesson title or summary is invalid");
  const lesson = await db.lesson.findFirst({ where: { id: lessonId, content: { courseId, isPublished: false } } });
  if (!lesson) throw new Error("Published lessons cannot be edited in place");
  await db.lesson.update({ where: { id: lessonId }, data: { title, summary: summary || null, approvedAt: null } });
  await db.courseContent.update({ where: { id: lesson.courseContentId }, data: { approvedAt: null } });
  await db.course.update({ where: { id: courseId }, data: { hasPendingChanges: true } });
  await audit(actor.id, "LESSON_EDITED", "Lesson", lessonId);
  revalidatePath(`/teacher/courses/${courseId}`);
}

export async function enrollEmployees(formData: FormData) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const courseId = String(formData.get("courseId"));
  const employeeIds = uniqueIds(formData.getAll("employeeIds"));
  if (!employeeIds.length) return { message: "Select at least one employee." };
  const course = await db.course.findUniqueOrThrow({ where: { id: courseId }, include: { companies: true } });
  if (course.status !== CourseStatus.PUBLISHED) return { message: "Publish this course before enrolling learners." };
  if (!course.isActive) throw new Error("Inactive courses cannot receive new learner enrollments.");
  const eligible = await db.employee.findMany({
    where: eligibleLearnerForCourseWhere(employeeIds),
    select: { id: true, name: true, email: true },
  });
  const existing = await db.enrollment.findMany({ where: { courseId, employeeId: { in: eligible.map((employee) => employee.id) } }, select: { employeeId: true } });
  const existingIds = new Set(existing.map((enrollment) => enrollment.employeeId));
  const newEmployees = eligible.filter((employee) => !existingIds.has(employee.id));
  if (newEmployees.length) {
    await db.$transaction(newEmployees.map(({ id }) => db.enrollment.create({ data: { employeeId: id, courseId } })));
    for (const employee of newEmployees) await sendEnrollmentEmail({ employee, course });
  }
  await audit(actor.id, "EMPLOYEES_ENROLLED", "Course", courseId, { count: newEmployees.length });
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/admin/employees");
  return { message: `${newEmployees.length} employee(s) enrolled. ${eligible.length - newEmployees.length} were already enrolled or not eligible.` };
}

export async function enrollEmployeesFromPicker(_: { message?: string }, formData: FormData) {
  return enrollEmployees(formData);
}

export type EnrollmentImportState = { message?: string };

/**
 * Enrol a whole course roster from one uploaded file.
 *
 * Two things happen per row, and only the second one is new:
 *
 *   1. An e-mail already on file is matched to that employee. Everything else
 *      in the row — name, company, designation — is IGNORED for that row: the
 *      record on file is the truth, and a roster upload must not let a stray
 *      spelling in a spreadsheet quietly overwrite it.
 *   2. An e-mail nobody has seen becomes a new learner and is enrolled in the
 *      same pass. This is the point of the feature: a fixed course routinely
 *      has interns nobody has entered as an employee, and this admits them
 *      instead of bouncing the whole file back for one missing row. E-mail is
 *      the only thing that must be present — see course-enrollment-import.ts
 *      for the defaults used when a genuinely new row leaves the rest blank.
 *
 * Rows are handled one at a time, each in its own small transaction. A 1500-
 * row all-in-one-transaction import once meant a single e-mail collision threw
 * the entire batch away with nothing imported (see importEmployeesFromMaster);
 * a course roster is far smaller, but the failure mode is not one this app
 * repeats, so one bad row here costs that row and nothing else.
 */
export async function enrollFromTemplate(_: EnrollmentImportState, formData: FormData): Promise<EnrollmentImportState> {
  const courseId = String(formData.get("courseId") ?? "");
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course) return { message: "Course not found." };
  if (course.status !== CourseStatus.PUBLISHED) return { message: "Publish this course before enrolling learners." };
  if (!course.isActive) return { message: "Reactivate this course before enrolling new learners." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { message: "Select a CSV or Excel roster file." };

  let rawRows: Awaited<ReturnType<typeof readTabularFile>>;
  try {
    rawRows = await readTabularFile(file);
  } catch (error) {
    return { message: error instanceof Error ? error.message : "The roster file could not be read." };
  }
  if (!rawRows.length) return { message: "The roster file is empty." };
  if (!hasEmailColumn(rawRows[0])) return { message: "The roster file must have an EMAIL column." };

  const rows = rawRows.map(parseCourseEnrollmentRow).filter((row) => row.email);
  const skippedNoEmail = rawRows.length - rows.length;
  if (!rows.length) return { message: "No row in the file has an e-mail address." };

  // One row per address: a roster naming the same person twice should not be
  // read as two people, and de-duplicating here means the per-row loop below
  // never has to reason about a second row un-doing the first.
  const byEmail = new Map(rows.map((row) => [row.email, row]));
  const emails = [...byEmail.keys()];

  const existingEmployees = await db.employee.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
  const employeeIdByEmail = new Map(existingEmployees.map((employee) => [employee.email, employee.id]));
  const newEmails = emails.filter((email) => !employeeIdByEmail.has(email));

  // Companies for the NEW people only — existing employees keep the company
  // they already have. Matched loosely against what LMS already holds, the
  // same way importEmployeesFromMaster does: "Interns" and "interns" must
  // resolve to one company, or half the batch ends up in a company no course
  // is linked to and vanishes from the enrolment picker.
  const existingCompanies = await db.company.findMany({ select: { id: true, name: true } });
  const companyIdByNormalised = new Map(existingCompanies.map((c) => [normaliseCompany(c.name), c.id]));
  const wantedCompanyNames = new Set(
    newEmails.map((email) => byEmail.get(email)!.company.trim() || "Interns"),
  );
  for (const name of wantedCompanyNames) {
    const key = normaliseCompany(name);
    if (companyIdByNormalised.has(key)) continue;
    const created = await db.company.create({ data: { name } });
    companyIdByNormalised.set(key, created.id);
  }

  // Resolved OUTSIDE any transaction, same reasoning as everywhere else this
  // is done in this file: it is a network call to another container, and
  // holding a database transaction open across it is how a slow neighbour
  // turns into lock contention here. Only the new people need it.
  const personIds = new Map<string, string | null>();
  for (let i = 0; i < newEmails.length; i += 10) {
    const chunk = newEmails.slice(i, i + 10);
    const resolved = await Promise.all(chunk.map((email) => {
      const row = byEmail.get(email)!;
      return resolvePersonId(email, row.name || nameFromEmail(email), row.employeeCode || undefined);
    }));
    chunk.forEach((email, index) => personIds.set(email, resolved[index]));
  }

  let created = 0;
  let enrolled = 0;
  let alreadyEnrolled = 0;
  const rowErrors: string[] = [];

  for (const email of emails) {
    const row = byEmail.get(email)!;
    try {
      const employeeId = await db.$transaction(async (tx) => {
        let id = employeeIdByEmail.get(email);
        if (!id) {
          const companyId = companyIdByNormalised.get(normaliseCompany(row.company.trim() || "Interns"))!;
          const employee = await tx.employee.create({
            data: {
              employeeCode: row.employeeCode || internEmployeeCode(email),
              name: row.name || nameFromEmail(email),
              email,
              companyId,
              department: "General",
              designation: row.designation || "Intern",
              status: EmployeeStatus.ACTIVE,
              personId: personIds.get(email) ?? null,
            },
          });
          id = employee.id;
          const user = await tx.user.upsert({
            where: { email },
            update: { employeeId: id },
            create: { email, employeeId: id },
          });
          await tx.userRoleGrant.upsert({
            where: { userId_role: { userId: user.id, role: UserRole.LEARNER } },
            update: {},
            create: { userId: user.id, role: UserRole.LEARNER },
          });
        }
        return id;
      });

      const existingEnrollment = await db.enrollment.findUnique({
        where: { employeeId_courseId: { employeeId, courseId } },
        select: { id: true },
      });
      if (existingEnrollment) {
        alreadyEnrolled += 1;
        continue;
      }

      const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
      await db.enrollment.create({ data: { employeeId, courseId } });
      if (!employeeIdByEmail.has(email)) created += 1;
      enrolled += 1;
      await sendEnrollmentEmail({ employee, course });
    } catch (error) {
      rowErrors.push(`${email}: ${error instanceof Error ? error.message : "could not be enrolled"}`);
    }
  }

  await audit(actor.id, "COURSE_ROSTER_ENROLLED", "Course", courseId, {
    fileName: file.name, created, enrolled, alreadyEnrolled, skippedNoEmail, errors: rowErrors.length,
  });
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/admin/employees");

  const notes: string[] = [];
  if (created) notes.push(`${created} new learner${created === 1 ? "" : "s"} added`);
  if (alreadyEnrolled) notes.push(`${alreadyEnrolled} already enrolled`);
  if (skippedNoEmail) notes.push(`${skippedNoEmail} row${skippedNoEmail === 1 ? "" : "s"} skipped with no e-mail`);
  if (rowErrors.length) notes.push(`${rowErrors.length} row${rowErrors.length === 1 ? "" : "s"} failed (${rowErrors.slice(0, 3).join("; ")}${rowErrors.length > 3 ? "; and more" : ""})`);

  return { message: `${enrolled} learner(s) enrolled from the file${notes.length ? ` — ${notes.join("; ")}` : ""}.` };
}

export async function enrollEmployeeInCourses(_: { message?: string }, formData: FormData) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const employeeId = String(formData.get("employeeId") ?? "");
  const courseIds = uniqueIds(formData.getAll("courseIds"));
  if (!employeeId || !courseIds.length) return { message: "Select an employee and at least one course." };
  const employee = await db.employee.findUnique({ where: { id: employeeId }, include: { company: true, user: { include: { roles: true } } } });
  if (!employee || employee.status !== "ACTIVE") return { message: "Only active employees can be enrolled." };
  // No company gate. Any employee may be enrolled on any course and the admin
  // decides; matching by company was silently exclusive, because one firm under
  // two spellings left an employee eligible for nothing. Active and published
  // still hold — those are about the COURSE being fit to enrol on.
  const courses = await db.course.findMany({
    where: {
      id: { in: courseIds },
      isActive: true,
      status: CourseStatus.PUBLISHED,
    },
    include: { companies: true },
    orderBy: { title: "asc" },
  });
  if (!courses.length) return { message: "Only active, published courses can receive learner enrollments." };
  const existing = await db.enrollment.findMany({ where: { employeeId, courseId: { in: courses.map((course) => course.id) } }, select: { courseId: true } });
  const existingIds = new Set(existing.map((enrollment) => enrollment.courseId));
  const newCourses = courses.filter((course) => !existingIds.has(course.id));
  if (newCourses.length) {
    await db.$transaction(newCourses.map((course) => db.enrollment.create({ data: { employeeId, courseId: course.id } })));
    for (const course of newCourses) await sendEnrollmentEmail({ employee, course });
  }
  await audit(actor.id, "EMPLOYEE_ENROLLED_IN_COURSES", "Employee", employeeId, { count: newCourses.length });
  revalidatePath("/admin/employees");
  revalidatePath("/admin/courses");
  for (const course of newCourses) revalidatePath(`/admin/courses/${course.id}`);
  return {
    message: `${newCourses.length} course(s) allocated to ${employee.name}. ${courses.length - newCourses.length} were already allocated. ${courseIds.length - courses.length} were unavailable or not eligible.`,
  };
}

export async function deleteCourse(_: { message?: string }, formData: FormData): Promise<{ message?: string }> {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const courseId = String(formData.get("courseId") ?? "");
  const course = await db.course.findUnique({
    where: { id: courseId },
    include: {
      contents: { include: { lessons: { select: { pageAssetKeys: true } } } },
    },
  });
  if (!course) return { message: "Course not found." };
  if (String(formData.get("confirmTitle") ?? "").trim() !== course.title) return { message: "Type the complete course title exactly to confirm deletion." };
  const storedKeys = new Set<string>();
  for (const content of course.contents) {
    storedKeys.add(content.storedKey);
    for (const lesson of content.lessons) {
      if (Array.isArray(lesson.pageAssetKeys)) {
        for (const key of lesson.pageAssetKeys) if (typeof key === "string") storedKeys.add(key);
      }
    }
  }
  await db.course.delete({ where: { id: courseId } });
  await audit(actor.id, "COURSE_DELETED", "Course", courseId, { title: course.title });
  await Promise.allSettled([...storedKeys].map((key) => storage.delete(key)));
  revalidatePath("/", "layout");
  redirect("/admin/courses");
}
