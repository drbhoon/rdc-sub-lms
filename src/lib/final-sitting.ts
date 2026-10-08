/**
 * Who may sit the final assessment, and when.
 *
 * The final does not open by itself. An admin schedules it for a classroom;
 * each learner then has ONE attempt, and an admin can allow another to a
 * particular learner. These are the rules, kept free of the database so every
 * case is tested on its own: the learner page, the Start button and the admin
 * screen all ask this one function, so they cannot disagree.
 */
export type FinalSchedule = { opensAt: Date; closesAt: Date | null };

export type FinalSittingInput = {
  now: Date;
  /** The schedule of THIS learner's classroom (or of the no-classroom group). */
  schedule: FinalSchedule | null;
  /** Attempts already started on the live final, finished or not. */
  attemptsUsed: number;
  attemptsAllowed: number;
  /** An attempt started and still inside its own time limit: it can be resumed. */
  hasResumable: boolean;
  /** An admin let this learner sit it outside the classroom's schedule. */
  adminOpened: boolean;
};

export type FinalSitting =
  | { state: "RESUME" }
  | { state: "USED" }
  | { state: "NOT_SCHEDULED" }
  | { state: "SCHEDULED"; opensAt: Date }
  | { state: "OPEN"; closesAt: Date | null }
  | { state: "CLOSED"; closedAt: Date };

export function finalSitting(input: FinalSittingInput): FinalSitting {
  // Part-way through: carry on. The window closing does not take a sitting
  // away from someone already in it; their own time limit does that.
  if (input.hasResumable) return { state: "RESUME" };
  if (input.attemptsUsed >= input.attemptsAllowed) return { state: "USED" };
  // An admin's permission beats the schedule, in both directions: it lets
  // someone in before it opens or after it closes, which is what makes a
  // second attempt possible once the class's window is over.
  if (input.adminOpened) return { state: "OPEN", closesAt: null };
  const { schedule, now } = input;
  if (!schedule) return { state: "NOT_SCHEDULED" };
  if (now < schedule.opensAt) return { state: "SCHEDULED", opensAt: schedule.opensAt };
  if (schedule.closesAt && now >= schedule.closesAt) return { state: "CLOSED", closedAt: schedule.closesAt };
  return { state: "OPEN", closesAt: schedule.closesAt };
}

/** Whether a started attempt is still inside its time limit, so it can be resumed. */
export function isResumable(attempt: { status: string; startedAt: Date }, timeLimitSeconds: number, now: Date): boolean {
  return attempt.status === "IN_PROGRESS" && now.getTime() - attempt.startedAt.getTime() < timeLimitSeconds * 1000;
}

/** Seconds a resumed attempt has left, never below zero. */
export function secondsLeft(startedAt: Date, timeLimitSeconds: number, now: Date): number {
  return Math.max(0, timeLimitSeconds - Math.floor((now.getTime() - startedAt.getTime()) / 1000));
}

/**
 * Giving a learner another go. Exactly one more attempt than they have used,
 * not one more than they were allowed, so allowing a learner who has not yet
 * sat it leaves them with their single attempt rather than quietly giving two.
 * The learner is also let in outside the schedule.
 */
export function afterAllowing(current: { attemptsUsed: number; attemptsAllowed: number }) {
  return { attemptsAllowed: Math.max(current.attemptsAllowed, current.attemptsUsed + 1), adminOpened: true };
}
