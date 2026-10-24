import { db } from "@/lib/db";
import { setLessonCompletion } from "@/lib/lesson-completion";
import type { ScormInit } from "@/lib/scorm-api";
import { fromLessonStatus, nextLaunch, outcomeOf, updateFromCommit, type AttemptState, type Commit, type NextLaunch } from "@/lib/scorm-runtime";

/** What a SCORM lesson's `keyPoints` carries, written by the worker when it unpacked the package. */
export function scormFacts(keyPoints: unknown) {
  const facts = (keyPoints && typeof keyPoints === "object" ? keyPoints : {}) as Record<string, unknown>;
  return {
    version: facts.scormVersion === "2004" ? ("2004" as const) : ("1.2" as const),
    launchPath: typeof facts.launchPath === "string" ? facts.launchPath : "index.html",
    masteryScore: typeof facts.masteryScore === "number" ? facts.masteryScore : null,
  };
}

const toState = (attempt: { id: string; attemptNumber: number; completionStatus: string; successStatus: string; suspended: boolean; finished: boolean; resetAt: Date | null }): AttemptState => attempt;

/** Where a learner stands in a SCORM lesson: the attempts so far and what opening it would do. */
export async function scormStanding(enrollmentId: string, lessonId: string) {
  const attempts = await db.scormAttempt.findMany({ where: { enrollmentId, lessonId }, orderBy: { attemptNumber: "asc" } });
  const next: NextLaunch = nextLaunch(attempts.map(toState));
  const counting = attempts.filter((attempt) => !attempt.resetAt);
  const best = counting.reduce<number | null>((top, attempt) => (attempt.scoreRaw !== null && (top === null || attempt.scoreRaw > top) ? attempt.scoreRaw : top), null);
  return { attempts, counting, next, bestScore: best };
}

export type ScormLaunch = {
  attemptId: string | null;
  contentId: string;
  launchPath: string;
  init: ScormInit;
  mode: "start" | "resume" | "retry" | "review" | "preview";
};

type LaunchLearner = { employeeCode: string; name: string };

/**
 * Open (or create) the attempt a learner is about to run. `preview` is for
 * course managers trying the package: it runs without recording anything.
 */
export async function openScormAttempt(args: {
  lesson: { id: string; courseContentId: string; keyPoints: unknown };
  learner: LaunchLearner;
  enrollmentId: string | null;
}): Promise<ScormLaunch | { locked: true }> {
  const facts = scormFacts(args.lesson.keyPoints);
  const base: ScormInit = {
    version: facts.version, learnerId: args.learner.employeeCode, learnerName: args.learner.name,
    location: "", suspendData: "", completionStatus: "not attempted", successStatus: "unknown",
    scoreRaw: null, scoreMin: null, scoreMax: null, totalSeconds: 0, entry: "ab-initio", masteryScore: facts.masteryScore, browse: false,
  };
  const common = { contentId: args.lesson.courseContentId, launchPath: facts.launchPath };
  if (!args.enrollmentId) return { ...common, attemptId: null, init: { ...base, browse: true }, mode: "preview" };

  const { next } = await scormStanding(args.enrollmentId, args.lesson.id);
  if (next.kind === "locked") return { locked: true };

  if (next.kind === "start" || next.kind === "retry") {
    const created = await db.scormAttempt.create({ data: { enrollmentId: args.enrollmentId, lessonId: args.lesson.id, attemptNumber: next.attemptNumber } });
    return { ...common, attemptId: created.id, init: base, mode: next.kind };
  }
  const attempt = await db.scormAttempt.findUniqueOrThrow({ where: { id: next.attempt.id } });
  const carried: ScormInit = {
    ...base,
    location: attempt.location ?? "", suspendData: attempt.suspendData ?? "",
    completionStatus: attempt.completionStatus, successStatus: attempt.successStatus,
    scoreRaw: attempt.scoreRaw, scoreMin: attempt.scoreMin, scoreMax: attempt.scoreMax, totalSeconds: attempt.totalSeconds,
  };
  if (next.kind === "review") return { ...common, attemptId: null, init: { ...carried, browse: true, entry: "resume" }, mode: "review" };
  // Picking up an attempt left part-way: it is open again.
  await db.scormAttempt.update({ where: { id: attempt.id }, data: { suspended: false } });
  return { ...common, attemptId: attempt.id, init: { ...carried, entry: "resume" }, mode: "resume" };
}

/** Apply what the package reported. Returns whether the learner has now passed. */
export async function recordScormCommit(attemptId: string, employeeId: string, commit: Commit): Promise<{ passed: boolean; locked: boolean } | null> {
  const attempt = await db.scormAttempt.findUnique({ where: { id: attemptId }, include: { enrollment: true } });
  if (!attempt || attempt.enrollment.employeeId !== employeeId || attempt.resetAt) return null;
  // A late message from a package that has already ended (a closing tab sends one more) changes nothing.
  if (attempt.finished) return { passed: outcomeOf(attempt) === "passed", locked: false };

  const data = updateFromCommit(commit);
  // A 1.2 package sends its single lesson_status; fold it into the two we keep unless it also sent them.
  if (commit.lessonStatus && commit.completionStatus === undefined && commit.successStatus === undefined) {
    Object.assign(data, fromLessonStatus(commit.lessonStatus));
  }
  const updated = await db.scormAttempt.update({ where: { id: attempt.id }, data });
  const passed = outcomeOf(updated) === "passed";
  if (passed) await setLessonCompletion(attempt.enrollmentId, attempt.lessonId, true);
  else if (!updated.finished) await touchEnrollment(attempt.enrollmentId);
  const standing = await scormStanding(attempt.enrollmentId, attempt.lessonId);
  return { passed, locked: standing.next.kind === "locked" };
}

/** Opening a course counts as starting it, so it shows as in progress. */
async function touchEnrollment(enrollmentId: string) {
  await db.enrollment.updateMany({ where: { id: enrollmentId, status: "NOT_STARTED" }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
}

/** Give a learner two fresh attempts. Old ones stay on record, marked reset, and their numbers are not reused. */
export async function resetScormAttempts(enrollmentId: string, lessonId: string) {
  const reset = await db.scormAttempt.updateMany({ where: { enrollmentId, lessonId, resetAt: null }, data: { resetAt: new Date() } });
  // If they had passed, the pass no longer stands: they have to take it again.
  await setLessonCompletion(enrollmentId, lessonId, false);
  return reset.count;
}
