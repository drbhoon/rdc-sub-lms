"use server";

import { UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireCourseManager } from "@/lib/course-access";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

export type QuestionState = { message?: string; ok?: boolean };

const questionSchema = z.string().trim().min(5, "Write your question first.").max(2000, "Keep the question under 2000 characters.");
const answerSchema = z.string().trim().min(1, "Write an answer first.").max(4000, "Keep the answer under 4000 characters.");

/**
 * The teacher who answers a given learner is the one running the classroom that
 * learner currently sits in. Nothing is stored on the question itself, so
 * moving a learner between classrooms hands their open questions to whoever
 * teaches them now — the alternative, a snapshot, leaves questions addressed to
 * someone who no longer has anything to do with them.
 */
export async function findLearnerTeacher(employeeId: string, courseId: string) {
  const enrollment = await db.enrollment.findUnique({
    where: { employeeId_courseId: { employeeId, courseId } },
    include: { classroom: { include: { teacher: { include: { employee: true } } } } },
  });
  if (!enrollment) return { enrolled: false, teacher: null, classroomName: null };
  return {
    enrolled: true,
    teacher: enrollment.classroom?.teacher ?? null,
    classroomName: enrollment.classroom?.name ?? null,
  };
}

export async function askTeacher(_: QuestionState, formData: FormData): Promise<QuestionState> {
  const user = await requireRole(UserRole.LEARNER);
  if (!user.employeeId) return { message: "Learner profile required." };
  const courseId = String(formData.get("courseId") ?? "");
  const parsed = questionSchema.safeParse(formData.get("question"));
  if (!parsed.success) return { message: parsed.error.issues[0].message };

  const { enrolled, teacher } = await findLearnerTeacher(user.employeeId, courseId);
  if (!enrolled) return { message: "You are not enrolled in this course." };
  // Refused rather than queued for nobody: a question with no teacher would sit
  // unanswered with the learner believing it had been sent.
  if (!teacher) return { message: "You are not in a classroom yet, so there is no teacher to ask. Please use the AI assistant, or contact HR." };

  await db.courseQuestion.create({ data: { courseId, employeeId: user.employeeId, question: parsed.data } });
  revalidatePath(`/learn/courses/${courseId}`);
  revalidatePath(`/teacher/courses/${courseId}`);
  return { message: `Sent to ${teacher.employee?.name ?? teacher.email}. You will see the reply here.`, ok: true };
}

export async function answerLearnerQuestion(_: QuestionState, formData: FormData): Promise<QuestionState> {
  const questionId = String(formData.get("questionId") ?? "");
  const question = await db.courseQuestion.findUnique({ where: { id: questionId } });
  if (!question) return { message: "Question not found." };
  const actor = await requireCourseManager(question.courseId);

  const parsed = answerSchema.safeParse(formData.get("answer"));
  if (!parsed.success) return { message: parsed.error.issues[0].message };

  // A course manager may open the course, which is not the same as teaching
  // this learner. Anyone other than a super admin has to actually run the
  // classroom the learner sits in, so one teacher cannot answer another's.
  const roles = actor.roles.map((grant) => grant.role);
  if (!roles.includes(UserRole.SUPER_ADMIN)) {
    const { teacher } = await findLearnerTeacher(question.employeeId, question.courseId);
    const ownsAnyClassroom = await db.classroom.count({ where: { courseId: question.courseId, teacherUserId: actor.id } });
    if (ownsAnyClassroom > 0 && teacher?.id !== actor.id) {
      return { message: "That learner is in another teacher's classroom." };
    }
  }

  await db.courseQuestion.update({
    where: { id: questionId },
    data: { answer: parsed.data, answeredById: actor.id, answeredAt: new Date() },
  });
  await audit(actor.id, "COURSE_QUESTION_ANSWERED", "CourseQuestion", questionId, { courseId: question.courseId });
  revalidatePath(`/teacher/courses/${question.courseId}`);
  revalidatePath(`/learn/courses/${question.courseId}`);
  return { message: "Answer sent to the learner.", ok: true };
}
