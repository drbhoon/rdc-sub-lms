/**
 * Older "whole course" quizzes that a one-module course no longer needs.
 *
 * Quizzes used to belong to the course; they now belong to a module. A course
 * that was set up the old way still has its quiz with no module, and when its
 * only module later got a quiz of its own the learner was shown BOTH: two
 * assessments of the same single piece of content, the second usually the
 * first uploaded again under the default title "Course Assessment".
 *
 * In a course with ONE module, "the whole course" and "the module" are the same
 * thing, so once the module has its own quiz the module-less one is superseded:
 * not shown, and not required for the certificate. With several modules a
 * whole-course quiz is a different thing from any one module's, so nothing is
 * superseded. A course with only the module-less quiz keeps it.
 *
 * Shared by the learner page and the certificate check, because a quiz that is
 * hidden from the page must not still hold the certificate back.
 *
 * Nothing is deleted: the quiz, its attempts and every report are untouched,
 * and an admin can still see it (and take it offline) on the course page.
 */
export function supersededQuizIds(
  activeAssessments: { id: string; kind: string; courseContentId: string | null }[],
  moduleCount: number,
): Set<string> {
  if (moduleCount !== 1) return new Set();
  const quizzes = activeAssessments.filter((assessment) => assessment.kind !== "FINAL");
  if (!quizzes.some((assessment) => assessment.courseContentId)) return new Set();
  return new Set(quizzes.filter((assessment) => !assessment.courseContentId).map((assessment) => assessment.id));
}
