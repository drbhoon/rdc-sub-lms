/**
 * Why a certificate cannot be issued, in words an administrator can act on.
 *
 * The certificate rules (certificate-eligibility.ts) only say what is missing; this adds the facts
 * around them, such as an unpublished course, a learner not marked complete, or lessons published after
 * the learner finished, so the admin who clicks "Download certificate" is told which one it is instead
 * of one message that covers them all.
 */
export type CertificateFacts = {
  enrolled: boolean;
  courseStatus: string | null;
  completedAt: Date | null;
  completedLessons: number;
  totalLessons: number;
  /** What certificateEligibility reported as missing. */
  missing: string[];
};

const LESSON_RULE = "Complete all lessons.";

export function certificateBlockers(facts: CertificateFacts): string[] {
  if (!facts.enrolled) return ["This learner is not enrolled in this course."];
  const reasons: string[] = [];
  const lessons = `${facts.completedLessons} of ${facts.totalLessons} lessons`;

  if (facts.courseStatus !== "PUBLISHED") {
    const state = (facts.courseStatus ?? "unknown").toLowerCase().replaceAll("_", " ");
    reasons.push(`The course is not published at the moment (it is "${state}"). A certificate is issued only while the course is published.`);
  }
  if (!facts.completedAt) {
    reasons.push(`The course is not recorded as completed for this learner: ${lessons} done. It is recorded once every approved lesson of every published module is done.`);
  }
  for (const rule of facts.missing) {
    if (rule === LESSON_RULE) {
      // Without a completion date the line above has already said it.
      if (facts.completedAt) reasons.push(`Not every lesson is done: ${lessons}. A module published after the learner finished counts too, and the learner has to open and finish it.`);
    } else reasons.push(rule);
  }
  return reasons.length ? reasons : ["The conditions for a certificate are not met."];
}
