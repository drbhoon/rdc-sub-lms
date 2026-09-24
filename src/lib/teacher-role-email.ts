/** The e-mail somebody gets when they are made a Teacher. Pure, so it can be tested. */

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export type TeacherRoleEmail = {
  name: string;
  email: string;
};

/**
 * The wording is HR's own (2026-09-24): "You have been assigned the role of
 * “Teacher.” Please login using this link". The link is the LMS sign-in page —
 * sign-in is an e-mailed code, so the only thing a new teacher needs to know
 * beyond the link is which address to type, and that is this one.
 */
export function teacherRoleMessage(input: TeacherRoleEmail, appUrl: string) {
  const link = `${appUrl.replace(/\/$/, "")}/login`;
  const subject = "RDC Learning: You have been assigned the role of Teacher";
  const text = [
    `Dear ${input.name},`,
    "",
    "You have been assigned the role of “Teacher.” Please login using this link:",
    link,
    "",
    `Sign in with this e-mail address (${input.email}); a one-time code will be sent to it.`,
    "",
    "Regards,",
    "RDC Learning",
  ].join("\n");
  const html = `<p>Dear ${escapeHtml(input.name)},</p><p>You have been assigned the role of &ldquo;Teacher.&rdquo; Please login using this link:</p><p><a href="${link}">${link}</a></p><p>Sign in with this e-mail address (${escapeHtml(input.email)}); a one-time code will be sent to it.</p><p>Regards,<br/>RDC Learning</p>`;
  return { subject, text, html };
}
