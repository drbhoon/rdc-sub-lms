"use server";

import { FeedbackQuestionType, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireCourseManager } from "@/lib/course-access";
import { db } from "@/lib/db";
import { parseFeedbackRows } from "@/lib/feedback-import";
import { requireRole } from "@/lib/session";
import { readTabularFile } from "@/lib/tabular-import";

type ActionState = { message?: string };

const uploadSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().trim().min(3).max(150).default("Course Feedback"),
});

export async function uploadFeedbackTemplate(_: ActionState, formData: FormData): Promise<ActionState> {
  const courseId = String(formData.get("courseId") ?? "");
  const actor = await requireCourseManager(courseId);
  const file = formData.get("file");
  if (!(file instanceof File)) return { message: "Select a feedback CSV or Excel file." };
  const parsed = uploadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { message: parsed.error.issues[0].message };

  try {
    const questions = parseFeedbackRows(await readTabularFile(file));
    const latest = await db.feedbackForm.aggregate({ where: { courseId }, _max: { version: true } });
    const version = (latest._max.version ?? 0) + 1;
    const form = await db.$transaction(async (tx) => {
      await tx.feedbackForm.updateMany({ where: { courseId, isActive: true }, data: { isActive: false } });
      return tx.feedbackForm.create({
        data: {
          courseId,
          title: parsed.data.title,
          version,
          isActive: true,
          questions: {
            create: questions.map((question) => ({
              order: question.order,
              questionText: question.questionText,
              type: question.type,
              required: question.required,
              options: question.options,
            })),
          },
        },
      });
    });
    await audit(actor.id, "FEEDBACK_TEMPLATE_UPLOADED", "FeedbackForm", form.id, { courseId, questionCount: questions.length, fileName: file.name });
    revalidatePath(`/admin/courses/${courseId}`);
    revalidatePath(`/teacher/courses/${courseId}`);
    revalidatePath(`/learn/courses/${courseId}`);
    return { message: `Feedback template v${version} activated with ${questions.length} questions.` };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Feedback template upload failed." };
  }
}

export type FeedbackSubmitState = { message?: string; ok?: boolean };

function validateFeedbackValue(type: FeedbackQuestionType, value: FormDataEntryValue[], required: boolean) {
  const strings = value.map(String).map((item) => item.trim()).filter(Boolean);
  if (required && !strings.length) return { ok: false, value: null };
  if (!strings.length) return { ok: true, value: "" };
  if (type === FeedbackQuestionType.RATING_1_5) {
    const rating = Number(strings[0]);
    return { ok: Number.isInteger(rating) && rating >= 1 && rating <= 5, value: rating };
  }
  if (type === FeedbackQuestionType.YES_NO) return { ok: ["YES", "NO"].includes(strings[0].toUpperCase()), value: strings[0].toUpperCase() };
  if (type === FeedbackQuestionType.MULTI_CHOICE) return { ok: true, value: strings };
  return { ok: true, value: strings[0] };
}

export async function submitFeedback(_: FeedbackSubmitState, formData: FormData): Promise<FeedbackSubmitState> {
  const user = await requireRole(UserRole.LEARNER);
  if (!user.employeeId) return { message: "Learner profile required." };
  const courseId = String(formData.get("courseId") ?? "");
  const formId = String(formData.get("formId") ?? "");
  const enrollment = await db.enrollment.findUnique({ where: { employeeId_courseId: { employeeId: user.employeeId, courseId } } });
  if (!enrollment || !enrollment.completedAt) return { message: "Feedback is available only after course completion." };
  const form = await db.feedbackForm.findFirst({ where: { id: formId, courseId, isActive: true }, include: { questions: { orderBy: { order: "asc" } } } });
  if (!form) return { message: "Active feedback form not found." };
  const answers = form.questions.map((question) => {
    const result = validateFeedbackValue(question.type, formData.getAll(`question_${question.id}`), question.required);
    if (!result.ok) throw new Error(`Answer required or invalid for: ${question.questionText}`);
    return { questionId: question.id, value: result.value };
  });
  try {
    await db.$transaction(async (tx) => {
      const response = await tx.feedbackResponse.upsert({
        where: { formId_employeeId: { formId: form.id, employeeId: user.employeeId! } },
        update: { submittedAt: new Date() },
        create: { formId: form.id, employeeId: user.employeeId! },
      });
      await tx.feedbackAnswer.deleteMany({ where: { responseId: response.id } });
      await tx.feedbackAnswer.createMany({ data: answers.map((answer) => ({ responseId: response.id, questionId: answer.questionId, value: answer.value as never })) });
    });
    revalidatePath(`/learn/courses/${courseId}`);
    return { message: "Feedback submitted. Thank you.", ok: true };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Feedback could not be submitted." };
  }
}
