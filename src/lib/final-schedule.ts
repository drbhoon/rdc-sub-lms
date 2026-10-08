import { AssessmentKind, AssessmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { finalSitting, isResumable, type FinalSchedule, type FinalSitting } from "@/lib/final-sitting";

/** The schedule row that covers learners in no classroom is keyed by this. */
export const NO_CLASSROOM = "none";

export const scheduleKey = (classroomId: string | null | undefined) => classroomId ?? NO_CLASSROOM;

/** The live final of a course, or null if none is built. */
export function activeFinalAssessment(courseId: string) {
  return db.assessment.findFirst({
    where: { courseId, kind: AssessmentKind.FINAL, status: AssessmentStatus.ACTIVE },
    select: { id: true, title: true, timeLimitSeconds: true, passPercentage: true, questionsPerAttempt: true, createdAt: true, _count: { select: { questions: true } } },
  });
}

/** Every schedule of the course, by classroom id (or NO_CLASSROOM). */
export async function loadFinalSchedules(courseId: string): Promise<Map<string, FinalSchedule>> {
  const rows = await db.finalAssessmentSchedule.findMany({ where: { courseId } });
  return new Map(rows.map((row) => [scheduleKey(row.classroomId), { opensAt: row.opensAt, closesAt: row.closesAt }]));
}

export type FinalAttemptSummary = {
  /** Started on the live final, finished or not: each one uses up an attempt. */
  used: number;
  /** An attempt still inside its own time limit. */
  resumable: { id: string; startedAt: Date } | null;
  /** Best submitted score, for showing; null if none submitted. */
  bestScore: number | null;
  passed: boolean;
  /** Started but never submitted and past its time limit: used, and not resumable. */
  abandoned: number;
};

/**
 * Each learner's attempts on the live final. Attempts on an earlier version of
 * the final do not count: building the final again is a new sitting, the same
 * way it already resets everyone's score for it.
 */
export async function loadFinalAttempts(assessmentId: string, timeLimitSeconds: number, employeeIds?: string[], now = new Date()): Promise<Map<string, FinalAttemptSummary>> {
  const attempts = await db.assessmentAttempt.findMany({
    where: { assessmentId, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) },
    select: { id: true, employeeId: true, status: true, startedAt: true, scorePercent: true, passed: true },
    orderBy: { startedAt: "asc" },
  });
  const summaries = new Map<string, FinalAttemptSummary>();
  for (const attempt of attempts) {
    const summary = summaries.get(attempt.employeeId) ?? { used: 0, resumable: null, bestScore: null, passed: false, abandoned: 0 };
    summary.used += 1;
    if (attempt.status === "SUBMITTED") {
      if (summary.bestScore === null || attempt.scorePercent > summary.bestScore) summary.bestScore = attempt.scorePercent;
      if (attempt.passed) summary.passed = true;
    } else if (isResumable(attempt, timeLimitSeconds, now)) {
      summary.resumable = { id: attempt.id, startedAt: attempt.startedAt };
    } else if (attempt.status === "IN_PROGRESS") {
      summary.abandoned += 1;
    }
    summaries.set(attempt.employeeId, summary);
  }
  return summaries;
}

export const emptyAttempts: FinalAttemptSummary = { used: 0, resumable: null, bestScore: null, passed: false, abandoned: 0 };

/** The one question everything asks: may this learner start the final now? */
export function sittingForEnrollment(
  enrollment: { classroomId: string | null; finalAttemptsAllowed: number; finalAdminOpened: boolean },
  schedules: Map<string, FinalSchedule>,
  attempts: FinalAttemptSummary,
  now = new Date(),
): FinalSitting {
  return finalSitting({
    now,
    schedule: schedules.get(scheduleKey(enrollment.classroomId)) ?? null,
    attemptsUsed: attempts.used,
    attemptsAllowed: enrollment.finalAttemptsAllowed,
    hasResumable: attempts.resumable !== null,
    adminOpened: enrollment.finalAdminOpened,
  });
}
