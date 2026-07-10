"use server";

import { AssessmentStatus, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { parseAssessmentRows } from "@/lib/assessment-import";
import { requireCourseManager } from "@/lib/course-access";
import { db } from "@/lib/db";
import { requireRole, requireUser } from "@/lib/session";
import { readTabularFile } from "@/lib/tabular-import";

type ActionState = { message?: string };

const uploadSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().trim().min(3).max(150).default("Course Assessment"),
  passPercentage: z.coerce.number().int().min(1).max(100),
  timeLimitMinutes: z.coerce.number().int().min(1).max(480),
});

export async function uploadAssessment(_: ActionState, formData: FormData): Promise<ActionState> {
  const courseId = String(formData.get("courseId") ?? "");
  const actor = await requireCourseManager(courseId);
  const file = formData.get("file");
  if (!(file instanceof File)) return { message: "Select an assessment CSV or Excel file." };
  const parsed = uploadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { message: parsed.error.issues[0].message };

  try {
    const rows = await readTabularFile(file);
    const questions = parseAssessmentRows(rows);
    const latest = await db.assessment.aggregate({ where: { courseId }, _max: { version: true } });
    const version = (latest._max.version ?? 0) + 1;
    const assessment = await db.$transaction(async (tx) => {
      await tx.assessment.updateMany({ where: { courseId, status: AssessmentStatus.ACTIVE }, data: { status: AssessmentStatus.INACTIVE } });
      return tx.assessment.create({
        data: {
          courseId,
          title: parsed.data.title,
          passPercentage: parsed.data.passPercentage,
          shuffleQuestions: formData.get("shuffleQuestions") === "on",
          timeLimitSeconds: parsed.data.timeLimitMinutes * 60,
          version,
          status: AssessmentStatus.ACTIVE,
          showLeaderboard: formData.get("showLeaderboard") === "on",
          questions: {
            create: questions.map((question) => ({
              order: question.order,
              questionText: question.questionText,
              optionA: question.optionA,
              optionB: question.optionB,
              optionC: question.optionC,
              optionD: question.optionD,
              correctOption: question.correctOption,
              timeSeconds: question.timeSeconds,
            })),
          },
        },
      });
    });
    await audit(actor.id, "ASSESSMENT_UPLOADED", "Assessment", assessment.id, { courseId, questionCount: questions.length, fileName: file.name, timeLimitMinutes: parsed.data.timeLimitMinutes, shuffleQuestions: formData.get("shuffleQuestions") === "on" });
    revalidatePath(`/admin/courses/${courseId}`);
    revalidatePath(`/teacher/courses/${courseId}`);
    revalidatePath(`/learn/courses/${courseId}`);
    return { message: `Assessment v${version} activated with ${questions.length} questions.` };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Assessment upload failed." };
  }
}

export async function setAssessmentStatus(formData: FormData) {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const status = String(formData.get("status") ?? "") as AssessmentStatus;
  if (status !== AssessmentStatus.ACTIVE && status !== AssessmentStatus.INACTIVE) throw new Error("Invalid assessment status.");
  const assessment = await db.assessment.findUniqueOrThrow({ where: { id: assessmentId } });
  const actor = await requireCourseManager(assessment.courseId);
  await db.$transaction(async (tx) => {
    if (status === AssessmentStatus.ACTIVE) {
      await tx.assessment.updateMany({ where: { courseId: assessment.courseId, status: AssessmentStatus.ACTIVE }, data: { status: AssessmentStatus.INACTIVE } });
    }
    await tx.assessment.update({ where: { id: assessmentId }, data: { status } });
  });
  await audit(actor.id, `ASSESSMENT_${status}`, "Assessment", assessmentId);
  revalidatePath(`/admin/courses/${assessment.courseId}`);
  revalidatePath(`/teacher/courses/${assessment.courseId}`);
  revalidatePath(`/learn/courses/${assessment.courseId}`);
}

export async function startAssessment(formData: FormData) {
  const courseId = String(formData.get("courseId") ?? "");
  const user = await requireRole(UserRole.LEARNER);
  if (!user.employeeId) redirect("/unauthorized");
  const enrollment = await db.enrollment.findUnique({
    where: { employeeId_courseId: { employeeId: user.employeeId, courseId } },
    include: { course: true },
  });
  if (!enrollment || enrollment.course.status !== "PUBLISHED") redirect("/unauthorized");
  const assessment = await db.assessment.findFirst({
    where: { courseId, status: AssessmentStatus.ACTIVE },
    include: { _count: { select: { questions: true } } },
  });
  if (!assessment || assessment._count.questions === 0) redirect(`/learn/courses/${courseId}`);
  const latest = await db.assessmentAttempt.aggregate({
    where: { assessmentId: assessment.id, employeeId: user.employeeId },
    _max: { attemptNumber: true },
  });
  const attempt = await db.assessmentAttempt.create({
    data: {
      assessmentId: assessment.id,
      employeeId: user.employeeId,
      enrollmentId: enrollment.id,
      attemptNumber: (latest._max.attemptNumber ?? 0) + 1,
      totalQuestions: assessment._count.questions,
    },
  });
  redirect(`/learn/courses/${courseId}/assessment/${attempt.id}`);
}

const answerSchema = z.object({
  questionId: z.string(),
  selectedOption: z.enum(["A", "B", "C", "D"]).nullable(),
  timeSpentSeconds: z.number().int().min(0).max(3600),
});

export type AssessmentSubmitState = { message?: string; scorePercent?: number; passed?: boolean };

export async function submitAssessment(_: AssessmentSubmitState, formData: FormData): Promise<AssessmentSubmitState> {
  const user = await requireUser();
  if (!user.employeeId) return { message: "Learner profile required." };
  const attemptId = String(formData.get("attemptId") ?? "");
  const rawAnswers = String(formData.get("answers") ?? "[]");
  const attempt = await db.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: { assessment: { include: { questions: true } }, enrollment: true },
  });
  if (!attempt || attempt.employeeId !== user.employeeId) return { message: "Assessment attempt not found." };
  if (attempt.status === "SUBMITTED") return { message: "This attempt has already been submitted.", scorePercent: attempt.scorePercent, passed: attempt.passed };

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawAnswers);
  } catch {
    return { message: "Assessment answers could not be read." };
  }
  const parsed = z.array(answerSchema).safeParse(decoded);
  if (!parsed.success) return { message: "Assessment answers could not be read." };
  const questionMap = new Map(attempt.assessment.questions.map((question) => [question.id, question]));
  const answers = parsed.data.filter((answer) => questionMap.has(answer.questionId));
  const seen = new Set<string>();
  const normalized = answers.filter((answer) => {
    if (seen.has(answer.questionId)) return false;
    seen.add(answer.questionId);
    return true;
  });
  const correctAnswers = normalized.filter((answer) => {
    const question = questionMap.get(answer.questionId);
    return Boolean(answer.selectedOption && question && answer.selectedOption === question.correctOption);
  }).length;
  const totalQuestions = attempt.assessment.questions.length;
  const scorePercent = totalQuestions ? Math.round((correctAnswers / totalQuestions) * 1000) / 10 : 0;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - attempt.startedAt.getTime()) / 1000));
  const timeTakenSeconds = Math.min(elapsedSeconds, attempt.assessment.timeLimitSeconds);
  const passed = scorePercent >= attempt.assessment.passPercentage;

  await db.$transaction(async (tx) => {
    for (const answer of normalized) {
      const question = questionMap.get(answer.questionId)!;
      await tx.assessmentAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: answer.questionId } },
        update: {
          selectedOption: answer.selectedOption,
          isCorrect: Boolean(answer.selectedOption && answer.selectedOption === question.correctOption),
          timeSpentSeconds: answer.timeSpentSeconds,
          answeredAt: new Date(),
        },
        create: {
          attemptId,
          questionId: answer.questionId,
          selectedOption: answer.selectedOption,
          isCorrect: Boolean(answer.selectedOption && answer.selectedOption === question.correctOption),
          timeSpentSeconds: answer.timeSpentSeconds,
        },
      });
    }
    await tx.assessmentAttempt.update({
      where: { id: attemptId },
      data: { status: "SUBMITTED", correctAnswers, totalQuestions, scorePercent, timeTakenSeconds, passed, submittedAt: new Date() },
    });
  });
  if (attempt.enrollment) revalidatePath(`/learn/courses/${attempt.enrollment.courseId}`);
  return { message: passed ? `Passed with ${scorePercent}%.` : `Submitted with ${scorePercent}%.`, scorePercent, passed };
}
