import { CourseEmailStatus, CourseEmailType } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isSmtpConfigured, transport } from "@/lib/course-notifications";
import { sessionCalendar } from "@/lib/ilt";
import { formatIst } from "@/lib/ist";

export type SessionMailKind = "invite" | "update" | "cancel";

type MailSession = {
  id: string; courseId: string; title: string; startsAt: Date; durationMinutes: number;
  meetUrl: string; instructorName: string | null; notes: string | null; updatedAt: Date;
};
type Recipient = { id: string; name: string; email: string };

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function message(kind: SessionMailKind, session: MailSession, recipient: Recipient, courseTitle: string) {
  const when = formatIst(session.startsAt);
  const link = `${env.APP_URL.replace(/\/$/, "")}/learn/courses/${session.courseId}`;
  const heading = kind === "cancel" ? "Session cancelled" : kind === "update" ? "Session rescheduled" : "Live session";
  const subject = `RDC Learning: ${heading} - ${session.title}`;
  const lines = kind === "cancel"
    ? [`The live session "${session.title}" (${courseTitle}), planned for ${when}, has been cancelled.`, "You do not need to do anything. If it is held again you will be told."]
    : [
      kind === "update" ? `The live session "${session.title}" (${courseTitle}) has changed. Please note the new details.` : `You are invited to the live session "${session.title}" (${courseTitle}).`,
      `When: ${when} (${session.durationMinutes} minutes)`,
      session.instructorName ? `Instructor: ${session.instructorName}` : "",
      `Join with Google Meet: ${session.meetUrl}`,
      session.notes ? `Note: ${session.notes}` : "",
      "Attendance is confirmed by the instructor, so please join on time with your own name showing. Your assessment and feedback open from the course page.",
    ].filter(Boolean);
  const text = [`Dear ${recipient.name},`, "", ...lines, "", `Course page: ${link}`, "", "Regards,", "RDC Learning"].join("\n");
  const html = `<p>Dear ${escapeHtml(recipient.name)},</p>${lines.map((line) => `<p>${escapeHtml(line).replace(escapeHtml(session.meetUrl), `<a href="${session.meetUrl}">${escapeHtml(session.meetUrl)}</a>`)}</p>`).join("")}<p><a href="${link}">Open the course</a></p><p>Regards,<br/>RDC Learning</p>`;
  return { subject, text, html };
}

/** One e-mail with a calendar entry attached. The outcome is logged beside the other course e-mails. */
export async function sendSessionEmail(kind: SessionMailKind, session: MailSession, recipient: Recipient, courseTitle: string) {
  const content = message(kind, session, recipient, courseTitle);
  let status: CourseEmailStatus = CourseEmailStatus.SENT;
  let error: string | undefined;
  if (!isSmtpConfigured()) {
    status = CourseEmailStatus.SKIPPED;
    error = "SMTP is not configured";
  } else {
    try {
      const calendar = sessionCalendar({
        id: session.id, title: session.title, startsAt: session.startsAt, durationMinutes: session.durationMinutes, meetUrl: session.meetUrl,
        description: `${courseTitle}${session.instructorName ? `\nInstructor: ${session.instructorName}` : ""}`,
        organiser: (env.SMTP_FROM.match(/<([^>]+)>/)?.[1] ?? env.SMTP_FROM).trim(),
        sequence: Math.floor(session.updatedAt.getTime() / 1000), cancelled: kind === "cancel",
      });
      await transport().sendMail({
        from: env.SMTP_FROM, to: recipient.email, subject: content.subject, text: content.text, html: content.html,
        icalEvent: { filename: "session.ics", method: kind === "cancel" ? "CANCEL" : "REQUEST", content: calendar },
      });
    } catch (caught) {
      status = CourseEmailStatus.FAILED;
      error = caught instanceof Error ? caught.message.slice(0, 1000) : "Unknown SMTP error";
    }
  }
  await db.courseEmailLog.create({
    data: { type: CourseEmailType.SESSION, status, courseId: session.courseId, employeeId: recipient.id, recipientEmail: recipient.email, subject: content.subject, error },
  });
  return status;
}

/** To everyone, a few at a time (SMTP takes seconds per message). */
export async function sendSessionEmails(kind: SessionMailKind, session: MailSession, recipients: Recipient[], courseTitle: string) {
  const counts = { SENT: 0, FAILED: 0, SKIPPED: 0 };
  for (let i = 0; i < recipients.length; i += 5) {
    const results = await Promise.all(recipients.slice(i, i + 5).map((recipient) =>
      sendSessionEmail(kind, session, recipient, courseTitle).catch(() => CourseEmailStatus.FAILED)));
    for (const result of results) counts[result] += 1;
  }
  return counts;
}
