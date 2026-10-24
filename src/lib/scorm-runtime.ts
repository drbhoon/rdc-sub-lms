import { z } from "zod";

/**
 * The rules of a SCORM attempt, with no database in sight so they can be tested
 * on their own.
 *
 * The decisions behind them (Dr Bhoon's):
 *  - the package's own pass/fail is final: no second opinion from the LMS;
 *  - a learner gets two attempts; an admin can reset them;
 *  - leaving part-way is not an attempt used: coming back resumes where they were.
 */
export const MAX_SCORM_ATTEMPTS = 2;

export type AttemptState = {
  id: string;
  attemptNumber: number;
  completionStatus: string;
  successStatus: string;
  suspended: boolean;
  finished: boolean;
  resetAt: Date | null;
};

export type Outcome = "passed" | "failed" | "incomplete" | "not started";

/** What this attempt amounts to. The package says "passed" or "failed" when it tests; otherwise completing is passing. */
export function outcomeOf(attempt: Pick<AttemptState, "completionStatus" | "successStatus">): Outcome {
  if (attempt.successStatus === "passed") return "passed";
  if (attempt.successStatus === "failed") return "failed";
  if (attempt.completionStatus === "completed") return "passed";
  if (attempt.completionStatus === "incomplete") return "incomplete";
  return "not started";
}

export type NextLaunch =
  | { kind: "start"; attemptNumber: number }
  | { kind: "resume"; attempt: AttemptState }
  | { kind: "retry"; attemptNumber: number }
  | { kind: "review"; attempt: AttemptState }
  | { kind: "locked" };

/** What happens when a learner opens the course now. `allAttempts` includes reset ones, whose numbers are never reused. */
export function nextLaunch(allAttempts: AttemptState[], max = MAX_SCORM_ATTEMPTS): NextLaunch {
  const highest = allAttempts.reduce((top, attempt) => Math.max(top, attempt.attemptNumber), 0);
  const counting = allAttempts.filter((attempt) => !attempt.resetAt).sort((a, b) => a.attemptNumber - b.attemptNumber);
  const last = counting[counting.length - 1];
  if (!last) return { kind: "start", attemptNumber: highest + 1 };
  if (outcomeOf(last) === "passed") return { kind: "review", attempt: last };
  if (!last.finished) return { kind: "resume", attempt: last };
  if (counting.length >= max) return { kind: "locked" };
  return { kind: "retry", attemptNumber: highest + 1 };
}

// ---- what the package reports, as the browser sends it on a commit ----

const completion = z.enum(["completed", "incomplete", "not attempted", "unknown"]);
const success = z.enum(["passed", "failed", "unknown"]);
const finite = z.number().finite();

export const commitSchema = z.object({
  completionStatus: completion.optional(),
  successStatus: success.optional(),
  lessonStatus: z.string().max(40).optional(),
  scoreRaw: finite.min(-1_000_000).max(1_000_000).nullable().optional(),
  scoreMin: finite.min(-1_000_000).max(1_000_000).nullable().optional(),
  scoreMax: finite.min(-1_000_000).max(1_000_000).nullable().optional(),
  location: z.string().max(1000).optional(),
  suspendData: z.string().max(500_000).optional(),
  totalSeconds: z.number().int().min(0).max(30 * 24 * 3600).optional(),
  /** The value of exit the package set: "suspend" means it will be resumed. */
  exit: z.string().max(20).optional(),
  /** The package called Terminate / LMSFinish. */
  finish: z.boolean().optional(),
});
export type Commit = z.infer<typeof commitSchema>;

/** The columns to write for a commit; only what the package actually sent. */
export function updateFromCommit(commit: Commit) {
  const data: Record<string, unknown> = { lastCommitAt: new Date() };
  if (commit.completionStatus !== undefined) data.completionStatus = commit.completionStatus;
  if (commit.successStatus !== undefined) data.successStatus = commit.successStatus;
  if (commit.lessonStatus !== undefined) data.lessonStatus = commit.lessonStatus;
  if (commit.scoreRaw !== undefined) data.scoreRaw = commit.scoreRaw;
  if (commit.scoreMin !== undefined) data.scoreMin = commit.scoreMin;
  if (commit.scoreMax !== undefined) data.scoreMax = commit.scoreMax;
  if (commit.location !== undefined) data.location = commit.location;
  if (commit.suspendData !== undefined) data.suspendData = commit.suspendData;
  if (commit.totalSeconds !== undefined) data.totalSeconds = commit.totalSeconds;
  if (commit.finish) {
    // Asking to be resumed is not finishing; anything else ends the attempt.
    data.suspended = commit.exit === "suspend";
    data.finished = commit.exit !== "suspend";
  }
  return data;
}

/** SCORM 1.2 lesson_status -> the two statuses we keep (the 2004 pair). */
export function fromLessonStatus(status: string): { completionStatus: z.infer<typeof completion>; successStatus: z.infer<typeof success> } {
  switch (status.trim().toLowerCase()) {
    case "passed": return { completionStatus: "completed", successStatus: "passed" };
    case "failed": return { completionStatus: "completed", successStatus: "failed" };
    case "completed": return { completionStatus: "completed", successStatus: "unknown" };
    case "incomplete": return { completionStatus: "incomplete", successStatus: "unknown" };
    case "browsed": return { completionStatus: "incomplete", successStatus: "unknown" };
    default: return { completionStatus: "not attempted", successStatus: "unknown" };
  }
}

/** SCORM time strings. 1.2: "HHHH:MM:SS.SS". 2004: ISO 8601 duration "PT1H2M3S". Returns whole seconds, or null if unreadable. */
export function parseScormTime(value: string): number | null {
  const text = value.trim();
  const clock = text.match(/^(\d{1,4}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const iso = text.match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (iso && text.length > 1) {
    const [, y, mo, d, h, mi, s] = iso;
    return Math.floor(Number(y ?? 0) * 31_536_000 + Number(mo ?? 0) * 2_592_000 + Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0));
  }
  return null;
}

/** Seconds as a 1.2 total_time string: "0001:02:03.00". */
export function formatScormClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(Math.floor(seconds / 3600), 4)}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}.00`;
}

/** Seconds as a 2004 total_time duration: "PT1H2M3S". */
export function formatScormDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `PT${Math.floor(seconds / 3600)}H${Math.floor((seconds % 3600) / 60)}M${seconds % 60}S`;
}
