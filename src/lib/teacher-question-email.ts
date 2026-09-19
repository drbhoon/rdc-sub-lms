/** The e-mail a teacher gets when one of their learners asks a question. Pure, so it can be tested. */

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export type TeacherQuestionEmail = {
  teacherEmail: string;
  teacherName: string;
  learnerName: string;
  learnerCode: string;
  classroomName: string | null;
  courseId: string;
  courseTitle: string;
  question: string;
};

export function teacherQuestionMessage(input: TeacherQuestionEmail, appUrl: string) {
  const link = `${appUrl.replace(/\/$/, "")}/teacher/courses/${input.courseId}`;
  const from = `${input.learnerName} (${input.learnerCode}${input.classroomName ? `, ${input.classroomName}` : ""})`;
  const subject = `RDC Learning: question from ${input.learnerName} - ${input.courseTitle}`;
  const text = [
    `Dear ${input.teacherName},`,
    "",
    `${from} has asked you a question on the course "${input.courseTitle}":`,
    "",
    input.question,
    "",
    `Reply on the course page: ${link}`,
    "",
    "Regards,",
    "RDC Learning",
  ].join("\n");
  // The question is the learner's own words, so it is escaped before going
  // into HTML; everything else comes from our own records.
  const html = `<p>Dear ${escapeHtml(input.teacherName)},</p><p>${escapeHtml(from)} has asked you a question on the course <strong>${escapeHtml(input.courseTitle)}</strong>:</p><blockquote style="border-left:3px solid #ccc;margin:0;padding:4px 12px;white-space:pre-wrap">${escapeHtml(input.question)}</blockquote><p><a href="${link}">Reply on the course page</a></p><p>Regards,<br/>RDC Learning</p>`;
  return { subject, text, html };
}

