import { CourseEmailStatus, CourseEmailType } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isSmtpConfigured, transport } from "@/lib/course-notifications";
import { sessionCalendar } from "@/lib/ilt";
import { formatIst } from "@/lib/ist";
import { sessionPhase } from "@/lib/ilt";
import { learnersOnly } from "@/lib/teacher-preview";

export type SessionMailKind = "invite" | "update" | "cancel";

type MailSession = {
  id: string; courseId: string; title: string; startsAt: Date; durationMinutes: number;
  meetUrl: string; instructorName: string | null; notes: string | null; updatedAt: Date;
};
/** A learner, or one of the course's teachers (who have the link too). id is the employee record, when there is one. */
export type Recipient = { id?: string; name: string; email: string; teacher?: boolean };

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function message(kind: SessionMailKind, session: MailSession, recipient: Recipient, courseTitle: string) {
  const when = formatIst(session.startsAt);
  const link = `${env.APP_URL.replace(/\/$/, "")}/learn/courses/${session.courseId}`;
  const heading = kind === "cancel" ? "Session cancelled" : kind === "update" ? "Session rescheduled" : "Live session";
  const subject = `RDC Learning: ${heading} - ${session.title}`;
  const lines = kind === "cancel"
    ? [`The live session "${session.title}" (${courseTitle}), planned for ${when}, has been cancelled.`, "You do not need to do anything. If it is held again you will be told."]
    : [
      recipient.teacher ? `You are a teacher on ${courseTitle}. The live session "${session.title}" is arranged for its learners; the details and link are below.` : "",
      kind === "update" ? `The live session "${session.title}" (${courseTitle}) has changed. Please note the new details.` : recipient.teacher ? "" : `You are invited to the live session "${session.title}" (${courseTitle}).`,
      `When: ${when} (${session.durationMinutes} minutes)`,
      session.instructorName ? `Instructor: ${session.instructorName}` : "",
      `Join with Google Meet: ${session.meetUrl}`,
      session.notes ? `Note: ${session.notes}` : "",
      recipient.teacher
        ? "After the session, mark who attended on the course page: that is what completes it for them."
        : "Attendance is confirmed by the instructor, so please join on time with your own name showing. Your assessment and feedback open from the course page.",
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
  // The log is kept per employee record; a teacher with none is simply not logged.
  if (recipient.id) {
    await db.courseEmailLog.create({
      data: { type: CourseEmailType.SESSION, status, courseId: session.courseId, employeeId: recipient.id, recipientEmail: recipient.email, subject: content.subject, error },
    });
  }
  return status;
}

/** To everyone, a few at a time (SMTP takes seconds per message). */
export async function sendSessionEmails(kind: SessionMailKind, session: MailSession, recipients: Recipient[], courseTitle: string) {
  const counts = { SENT: 0, FAILED: 0, SKIPPED: 0 };
  const sentTo: Recipient[] = [];
  for (let i = 0; i < recipients.length; i += 5) {
    const batch = recipients.slice(i, i + 5);
    const results = await Promise.all(batch.map((recipient) =>
      sendSessionEmail(kind, session, recipient, courseTitle).catch(() => CourseEmailStatus.FAILED)));
    results.forEach((result, index) => { counts[result] += 1; if (result === CourseEmailStatus.SENT) sentTo.push(batch[index]); });
  }
  return { ...counts, sentTo };
}

/** Everyone a session concerns: the enrolled learners, and the course's teachers. One entry per e-mail address. */
export async function sessionRecipients(courseId: string): Promise<Recipient[]> {
  const [enrollments, teachers] = await Promise.all([
    db.enrollment.findMany({
      where: { courseId, ...learnersOnly, employee: { status: "ACTIVE" } },
      select: { employee: { select: { id: true, name: true, email: true } } },
    }),
    db.courseTeacher.findMany({ where: { courseId }, select: { user: { select: { email: true, employee: { select: { id: true, name: true } } } } } }),
  ]);
  const byEmail = new Map<string, Recipient>();
  for (const { user } of teachers) {
    byEmail.set(user.email.toLowerCase(), { id: user.employee?.id, name: user.employee?.name ?? user.email, email: user.email, teacher: true });
  }
  // A teacher who is also enrolled keeps the teacher's wording.
  for (const { employee } of enrollments) if (!byEmail.has(employee.email.toLowerCase())) byEmail.set(employee.email.toLowerCase(), employee);
  return [...byEmail.values()];
}

/**
 * Give people the link of every live session of a course they have not been sent yet.
 *
 * This is what makes the link follow the enrolment: whoever is enrolled (or made a teacher) on a course with
 * sessions gets each session's invitation, once, whether they joined before the session was published or
 * after. `who` is the people just added; left out, it is everyone (used when the course goes live).
 * A session counts while it is published, not cancelled and not over. Only mail that was actually sent is
 * remembered, so a person missed because SMTP was down is tried again next time.
 */
export async function shareSessions(courseId: string, who?: Recipient[], now = new Date()) {
  const sessions = await db.iltSession.findMany({
    where: { courseId, cancelledAt: null, course: { status: "PUBLISHED" }, lesson: { content: { isPublished: true, approvedAt: { not: null } } } },
    include: { course: { select: { title: true } } },
  });
  // Most courses have no sessions at all: nothing more to look up for them.
  if (!sessions.length) return 0;
  const everyone = who ?? await sessionRecipients(courseId);
  let sent = 0;
  for (const session of sessions) {
    if (sessionPhase(session, now) === "ended") continue;
    const already = new Set((await db.iltInvitation.findMany({ where: { sessionId: session.id }, select: { email: true } })).map((row) => row.email));
    const todo = everyone.filter((person) => !already.has(person.email.toLowerCase()));
    let sentHere = 0;
    for (let i = 0; i < todo.length; i += 5) {
      const results = await Promise.all(todo.slice(i, i + 5).map(async (person) => {
        const status = await sendSessionEmail("invite", session, person, session.course.title).catch(() => CourseEmailStatus.FAILED);
        if (status === CourseEmailStatus.SENT) await db.iltInvitation.upsert({ where: { sessionId_email: { sessionId: session.id, email: person.email.toLowerCase() } }, update: {}, create: { sessionId: session.id, email: person.email.toLowerCase() } });
        return status;
      }));
      sentHere += results.filter((status) => status === CourseEmailStatus.SENT).length;
    }
    if (sentHere && !session.invitationsSentAt) await db.iltSession.update({ where: { id: session.id }, data: { invitationsSentAt: new Date() } });
    sent += sentHere;
  }
  return sent;
}

/** Remember that these people have been sent a session's link (after the manual "E-mail invitations"). */
export async function recordInvitations(sessionId: string, recipients: Recipient[]) {
  await db.iltInvitation.createMany({ data: recipients.map((person) => ({ sessionId, email: person.email.toLowerCase() })), skipDuplicates: true });
}
