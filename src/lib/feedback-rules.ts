/**
 * Whether a learner has answered the feedback a course asks of them.
 *
 * The learner page and the certificate check each carried their own copy of
 * this, and a rule that gates a certificate must not be able to drift between
 * the screen that promises it and the route that issues it. One copy, here.
 *
 * Three kinds of ACTIVE form, answered differently:
 *  - a module form: once, for its own module;
 *  - a legacy whole-course form (no module): once for EVERY published module
 *    — it predates forms being module-scoped, and what was collected under it
 *    must keep meaning the same thing;
 *  - a FINAL form (about the final assessment): once.
 */
export type FeedbackFormForRules = {
  kind: "MODULE" | "FINAL";
  courseContentId: string | null;
  /** This learner's responses only. */
  responses: { courseContentId: string | null }[];
};

export function isFeedbackFormAnswered(form: FeedbackFormForRules, publishedContentIds: string[]): boolean {
  if (form.kind === "FINAL") return form.responses.length > 0;
  if (form.courseContentId) return form.responses.some((response) => response.courseContentId === form.courseContentId);
  const responded = new Set(form.responses.map((response) => response.courseContentId));
  return publishedContentIds.length > 0 && publishedContentIds.every((id) => responded.has(id));
}

/** True only when there is feedback to give and every active form has been answered. */
export function allFeedbackAnswered(forms: FeedbackFormForRules[], publishedContentIds: string[]): boolean {
  return forms.length > 0 && forms.every((form) => isFeedbackFormAnswered(form, publishedContentIds));
}
