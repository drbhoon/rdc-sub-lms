"use server";

import { CourseStatus, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireCourseManager } from "@/lib/course-access";
import { db } from "@/lib/db";
import { eligibleLearnerForCourseWhere } from "@/lib/enrollment-eligibility";
import { requireRole } from "@/lib/session";
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
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/teacher/courses/${courseId}`);
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
  const employeeIds = formData.getAll("employeeIds").map(String);
  const course = await db.course.findUniqueOrThrow({ where: { id: courseId }, include: { companies: true } });
  if (!course.isActive) throw new Error("Inactive courses cannot receive new learner enrollments.");
  const eligible = await db.employee.findMany({
    where: eligibleLearnerForCourseWhere(course.companies.map((company) => company.companyId), employeeIds),
    select: { id: true },
  });
  await db.$transaction(eligible.map(({ id }) => db.enrollment.upsert({ where: { employeeId_courseId: { employeeId: id, courseId } }, update: {}, create: { employeeId: id, courseId } })));
  await audit(actor.id, "EMPLOYEES_ENROLLED", "Course", courseId, { count: eligible.length });
  revalidatePath(`/admin/courses/${courseId}`);
}

export async function deleteCourse(formData: FormData) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const courseId = String(formData.get("courseId") ?? "");
  const course = await db.course.findUnique({
    where: { id: courseId },
    include: {
      _count: { select: { enrollments: true, assessments: true, feedbackForms: true } },
      assessments: { include: { _count: { select: { attempts: true } } } },
      feedbackForms: { include: { _count: { select: { responses: true } } } },
    },
  });
  if (!course) throw new Error("Course not found.");
  const attemptCount = course.assessments.reduce((sum, assessment) => sum + assessment._count.attempts, 0);
  const responseCount = course.feedbackForms.reduce((sum, form) => sum + form._count.responses, 0);
  if (course._count.enrollments || attemptCount || responseCount) {
    throw new Error("This course has learner history. Set it inactive instead of deleting.");
  }
  await db.course.delete({ where: { id: courseId } });
  await audit(actor.id, "COURSE_DELETED", "Course", courseId, { title: course.title });
  revalidatePath("/admin/courses");
  redirect("/admin/courses");
}
