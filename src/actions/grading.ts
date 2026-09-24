"use server";

import { AssessmentKind, AssessmentStatus, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { classroomScope } from "@/lib/classroom-scope";
import { requireCourseManager } from "@/lib/course-access";
import { buildFinalBank, checkGradingScheme, normaliseScheme, type GradingScheme } from "@/lib/course-grading";
import { courseModules, schemeFromRow } from "@/lib/course-grades";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

type ActionState = { message?: string };

function revalidateCourse(courseId: string) {
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/teacher/courses/${courseId}`);
  revalidatePath(`/learn/courses/${courseId}`);
}

/** Active module quizzes, one per module, in the order learners meet them. */
async function activeModuleQuizzes(courseId: string) {
  const modules = await courseModules(courseId);
  const quizzes = await db.assessment.findMany({
    where: { courseId, status: AssessmentStatus.ACTIVE, kind: AssessmentKind.MODULE, courseContentId: { not: null } },
    include: { questions: true },
  });
  const position = new Map(modules.map((module, index) => [module.id, index]));
  quizzes.sort((a, b) => (position.get(a.courseContentId!) ?? 1e9) - (position.get(b.courseContentId!) ?? 1e9));
  return { modules, quizzes };
}

const weight = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  return text === "" ? 0 : Number(text);
};

/**
 * Save how a course's result is made up. Admin only: the weights decide what a
 * learner's result means, so they are not a teacher's to change.
 */
export async function saveGradingScheme(_: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const courseId = String(formData.get("courseId") ?? "");
  const course = await db.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) return { message: "Course not found." };

  const { modules, quizzes } = await activeModuleQuizzes(courseId);
  const withQuiz = new Set(quizzes.map((quiz) => quiz.courseContentId));
  const moduleWeights: Record<string, number> = {};
  for (const module of modules) moduleWeights[module.id] = weight(formData.get(`module:${module.id}`));
  const input: GradingScheme = {
    teacherAssessmentEnabled: formData.get("teacherAssessmentEnabled") === "on",
    teacherWeight: weight(formData.get("teacherWeight")),
    finalWeight: weight(formData.get("finalWeight")),
    moduleWeights,
  };
  const hasFinal = (await db.assessment.count({ where: { courseId, kind: AssessmentKind.FINAL, status: AssessmentStatus.ACTIVE } })) > 0;
  const check = checkGradingScheme(input, modules.map((module) => ({ ...module, hasAssessment: withQuiz.has(module.id) })), hasFinal);
  if (check.errors.length) return { message: check.errors.join(" ") };

  const scheme = normaliseScheme(input, modules);
  await db.courseGrading.upsert({
    where: { courseId },
    update: { ...scheme, updatedByUserId: actor.id },
    create: { courseId, ...scheme, updatedByUserId: actor.id },
  });
  await audit(actor.id, "COURSE_GRADING_SAVED", "Course", courseId, scheme);
  revalidateCourse(courseId);
  return { message: ["Assessment weights saved. They total 100.", ...check.warnings].join(" ") };
}

const finalSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().trim().min(3).max(150).default("Final Assessment"),
  questionsPerAttempt: z.coerce.number().int().min(1, "Offer at least one question.").max(200),
  passPercentage: z.coerce.number().int().min(1).max(100),
  timeLimitMinutes: z.coerce.number().int().min(1).max(480),
});

/**
 * Build the course's final assessment from every module's active quiz.
 *
 * The bank is COPIED, not referenced, exactly as an uploaded quiz is: an
 * attempt's questions are drawn from its own assessment's bank, and a module
 * quiz being replaced later must not change a final that learners are already
 * sitting. Building again makes a new version and retires the old one, the
 * same way re-uploading a module quiz does.
 */
export async function buildFinalAssessment(_: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const parsed = finalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { message: parsed.error.issues[0].message };
  const { courseId, questionsPerAttempt } = parsed.data;

  const { quizzes } = await activeModuleQuizzes(courseId);
  if (!quizzes.length) return { message: "No module has an active quiz yet. Upload the module quizzes first; the final draws its questions from them." };
  const bank = buildFinalBank(quizzes.map((quiz) => ({ assessmentId: quiz.id, questions: quiz.questions })));
  if (questionsPerAttempt > bank.questions.length) {
    return { message: `The module quizzes hold ${bank.questions.length} distinct questions between them, so a final cannot offer ${questionsPerAttempt}.` };
  }

  const latest = await db.assessment.aggregate({ where: { courseId, kind: AssessmentKind.FINAL }, _max: { version: true } });
  const version = (latest._max.version ?? 0) + 1;
  const final = await db.$transaction(async (tx) => {
    await tx.assessment.updateMany({ where: { courseId, kind: AssessmentKind.FINAL, status: AssessmentStatus.ACTIVE }, data: { status: AssessmentStatus.INACTIVE } });
    return tx.assessment.create({
      data: {
        courseId,
        courseContentId: null,
        kind: AssessmentKind.FINAL,
        builtFromAssessmentIds: bank.sourceAssessmentIds,
        title: parsed.data.title,
        passPercentage: parsed.data.passPercentage,
        questionsPerAttempt,
        timeLimitSeconds: parsed.data.timeLimitMinutes * 60,
        // Always shuffled: the questions arrive grouped by module, and a final
        // that runs module 1, then module 2, ... tells the learner too much.
        shuffleQuestions: true,
        showLeaderboard: formData.get("showLeaderboard") === "on",
        version,
        status: AssessmentStatus.ACTIVE,
        questions: {
          create: bank.questions.map((question) => ({
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
  await audit(actor.id, "FINAL_ASSESSMENT_BUILT", "Assessment", final.id, {
    courseId, version, bankSize: bank.questions.length, questionsPerAttempt, fromModuleQuizzes: bank.sourceAssessmentIds.length,
  });
  revalidateCourse(courseId);
  return { message: `Final assessment v${version} is live: ${questionsPerAttempt} questions drawn at random for each learner from ${bank.questions.length} across ${quizzes.length} module quiz(zes).` };
}

const evaluationSchema = z.object({
  courseId: z.string().min(1),
  employeeId: z.string().min(1),
  score: z.coerce.number({ message: "Enter a score out of 100." }).int("The score must be a whole number.").min(0, "The score must be 0 or more.").max(100, "The score cannot be more than 100."),
  comments: z.string().trim().max(2000, "Keep comments under 2,000 characters.").default(""),
});

/**
 * A teacher's own score and comments for one learner.
 *
 * Classroom rules apply exactly as they do to the roster: a teacher running
 * classrooms on the course may assess only their own learners.
 */
export async function saveTeacherEvaluation(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = evaluationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { message: parsed.error.issues[0].message };
  const { courseId, employeeId, score, comments } = parsed.data;
  const actor = await requireCourseManager(courseId);

  const scheme = schemeFromRow(await db.courseGrading.findUnique({ where: { courseId } }));
  if (!scheme?.teacherAssessmentEnabled) return { message: "Teacher assessment is not switched on for this course." };

  const enrollment = await db.enrollment.findUnique({ where: { employeeId_courseId: { employeeId, courseId } } });
  if (!enrollment) return { message: "That learner is not on this course." };
  const owned = await db.classroom.findMany({ where: { courseId, teacherUserId: actor.id }, select: { id: true } });
  const scope = classroomScope({ roles: actor.roles.map((grant) => grant.role), ownedClassroomIds: owned.map((room) => room.id) });
  if (scope.scoped && !(enrollment.classroomId && scope.classroomIds.includes(enrollment.classroomId))) {
    return { message: "That learner is not in one of your classrooms." };
  }

  await db.teacherEvaluation.upsert({
    where: { courseId_employeeId: { courseId, employeeId } },
    update: { score, comments, teacherUserId: actor.id },
    create: { courseId, employeeId, score, comments, teacherUserId: actor.id },
  });
  await audit(actor.id, "TEACHER_EVALUATION_SAVED", "Employee", employeeId, { courseId, score });
  revalidateCourse(courseId);
  return { message: `Saved: ${score}/100.` };
}
