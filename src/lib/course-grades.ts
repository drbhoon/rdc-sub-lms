import { AssessmentKind, AssessmentStatus, type CourseGrading } from "@prisma/client";
import { db } from "@/lib/db";
import { computeCourseGrade, type CourseGrade, type GradingScheme } from "./course-grading";

/**
 * Loads what the course-result rules need and hands it to computeCourseGrade.
 * Every screen that shows a course result — admin, teacher, learner, the Excel
 * export — goes through here, so they cannot disagree about a learner's score.
 */

export type CourseModule = { id: string; label: string };

export function schemeFromRow(row: Pick<CourseGrading, "teacherAssessmentEnabled" | "teacherWeight" | "finalWeight" | "moduleWeights"> | null): GradingScheme | null {
  if (!row) return null;
  const raw = row.moduleWeights && typeof row.moduleWeights === "object" && !Array.isArray(row.moduleWeights)
    ? row.moduleWeights as Record<string, unknown>
    : {};
  const moduleWeights: Record<string, number> = {};
  for (const [id, weight] of Object.entries(raw)) moduleWeights[id] = Number(weight) || 0;
  return {
    teacherAssessmentEnabled: row.teacherAssessmentEnabled,
    teacherWeight: row.teacherWeight,
    finalWeight: row.finalWeight,
    moduleWeights,
  };
}

/**
 * A course's modules, numbered the way the learner sees them: published
 * content in upload order, named by its first lesson.
 */
export async function courseModules(courseId: string): Promise<CourseModule[]> {
  const contents = await db.courseContent.findMany({
    where: { courseId, isPublished: true },
    include: { lessons: { orderBy: { order: "asc" }, take: 1, select: { title: true } } },
    orderBy: { version: "asc" },
  });
  return contents.map((content, index) => ({
    id: content.id,
    label: `Module ${index + 1}: ${content.lessons[0]?.title ?? content.originalName}`,
  }));
}

export type LearnerGrade = {
  grade: CourseGrade;
  teacherEvaluation: { score: number; comments: string; updatedAt: Date } | null;
};

export type CourseGrades = {
  scheme: GradingScheme;
  modules: CourseModule[];
  byEmployee: Map<string, LearnerGrade>;
};

/**
 * Every listed learner's course result, or null when the course has no
 * weighted scheme yet.
 *
 * Scores are each learner's BEST submitted attempt on the ACTIVE quiz — the
 * same rule the certificate uses — so a result and a certificate never tell a
 * learner two different things.
 */
export async function loadCourseGrades(courseId: string, employeeIds: string[]): Promise<CourseGrades | null> {
  const grading = await db.courseGrading.findUnique({ where: { courseId } });
  const scheme = schemeFromRow(grading);
  if (!scheme) return null;

  const [modules, assessments, bestAttempts, evaluations] = await Promise.all([
    courseModules(courseId),
    db.assessment.findMany({
      where: { courseId, status: AssessmentStatus.ACTIVE },
      select: { id: true, kind: true, courseContentId: true },
    }),
    employeeIds.length
      ? db.assessmentAttempt.groupBy({
        by: ["assessmentId", "employeeId"],
        where: {
          status: "SUBMITTED",
          employeeId: { in: employeeIds },
          assessment: { courseId, status: AssessmentStatus.ACTIVE },
        },
        _max: { scorePercent: true },
      })
      : Promise.resolve([]),
    employeeIds.length
      ? db.teacherEvaluation.findMany({ where: { courseId, employeeId: { in: employeeIds } } })
      : Promise.resolve([]),
  ]);

  const assessmentById = new Map(assessments.map((assessment) => [assessment.id, assessment]));
  const moduleScores = new Map<string, Record<string, number>>();
  const finalScores = new Map<string, number>();
  for (const row of bestAttempts) {
    const assessment = assessmentById.get(row.assessmentId);
    const score = row._max.scorePercent;
    if (!assessment || score === null) continue;
    if (assessment.kind === AssessmentKind.FINAL) {
      finalScores.set(row.employeeId, Math.max(finalScores.get(row.employeeId) ?? 0, score));
    } else if (assessment.courseContentId) {
      const scores = moduleScores.get(row.employeeId) ?? {};
      scores[assessment.courseContentId] = Math.max(scores[assessment.courseContentId] ?? 0, score);
      moduleScores.set(row.employeeId, scores);
    }
  }
  const evaluationByEmployee = new Map(evaluations.map((evaluation) => [evaluation.employeeId, evaluation]));

  const byEmployee = new Map<string, LearnerGrade>();
  for (const employeeId of employeeIds) {
    const evaluation = evaluationByEmployee.get(employeeId) ?? null;
    byEmployee.set(employeeId, {
      grade: computeCourseGrade({
        scheme,
        modules,
        moduleScores: moduleScores.get(employeeId) ?? {},
        teacherScore: evaluation?.score ?? null,
        finalScore: finalScores.get(employeeId) ?? null,
      }),
      teacherEvaluation: evaluation ? { score: evaluation.score, comments: evaluation.comments, updatedAt: evaluation.updatedAt } : null,
    });
  }
  return { scheme, modules, byEmployee };
}
