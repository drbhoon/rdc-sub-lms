import nodemailer from "nodemailer";
import { after } from "next/server";
import { CourseEmailStatus, CourseEmailType, type Course, type Employee } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { type TeacherQuestionEmail, teacherQuestionMessage } from "./teacher-question-email";
import { type TeacherRoleEmail, teacherRoleMessage } from "./teacher-role-email";

type CourseEmailInput = {
  type: CourseEmailType;
  employee: Pick<Employee, "id" | "name" | "email">;
  course: Pick<Course, "id" | "title" | "durationMinutes">;
};

function isSmtpConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
}

function courseLink(courseId: string) {
  return `${env.APP_URL.replace(/\/$/, "")}/learn/courses/${courseId}`;
}

function transport() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
}

function enrollmentMessage(input: CourseEmailInput) {
  const link = courseLink(input.course.id);
  const subject = `RDC Learning: New course assigned - ${input.course.title}`;
  const text = [
    `Dear ${input.employee.name},`,
    "",
    `You have been enrolled in the course "${input.course.title}" on RDC Learning.`,
    `Expected duration: ${input.course.durationMinutes} minutes.`,
    "",
    `Open the course: ${link}`,
    "",
    "Regards,",
    "RDC Learning",
  ].join("\n");
  const html = `<p>Dear ${input.employee.name},</p><p>You have been enrolled in the course <strong>${input.course.title}</strong> on RDC Learning.</p><p>Expected duration: ${input.course.durationMinutes} minutes.</p><p><a href="${link}">Open the course</a></p><p>Regards,<br/>RDC Learning</p>`;
  return { subject, text, html };
}

function reminderMessage(input: CourseEmailInput) {
  const link = courseLink(input.course.id);
  const subject = `RDC Learning reminder: ${input.course.title}`;
  const text = [
    `Dear ${input.employee.name},`,
    "",
    `This is a reminder to complete your assigned course "${input.course.title}".`,
    "",
    `Open the course: ${link}`,
    "",
    "Regards,",
    "RDC Learning",
  ].join("\n");
  const html = `<p>Dear ${input.employee.name},</p><p>This is a reminder to complete your assigned course <strong>${input.course.title}</strong>.</p><p><a href="${link}">Open the course</a></p><p>Regards,<br/>RDC Learning</p>`;
  return { subject, text, html };
}

export async function sendCourseEmail(input: CourseEmailInput) {
  const message = input.type === CourseEmailType.ENROLLMENT ? enrollmentMessage(input) : reminderMessage(input);
  let status: CourseEmailStatus = CourseEmailStatus.SENT;
  let error: string | undefined;

  if (!isSmtpConfigured()) {
    status = CourseEmailStatus.SKIPPED;
    error = "SMTP is not configured";
  } else {
    try {
      await transport().sendMail({
        from: env.SMTP_FROM,
        to: input.employee.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (caught) {
      status = CourseEmailStatus.FAILED;
      error = caught instanceof Error ? caught.message.slice(0, 1000) : "Unknown SMTP error";
    }
  }

  await db.courseEmailLog.create({
    data: {
      type: input.type,
      status,
      courseId: input.course.id,
      employeeId: input.employee.id,
      recipientEmail: input.employee.email,
      subject: message.subject,
      error,
    },
  });
  return status;
}

export async function sendEnrollmentEmail(input: Omit<CourseEmailInput, "type">) {
  return sendCourseEmail({ ...input, type: CourseEmailType.ENROLLMENT });
}

export async function sendReminderEmail(input: Omit<CourseEmailInput, "type">) {
  return sendCourseEmail({ ...input, type: CourseEmailType.REMINDER });
}

export type { TeacherQuestionEmail };

/**
 * Tell a teacher a learner has asked them something. Best effort: the
 * question is already saved and shown on the teacher's course page, so a mail
 * failure is logged and never undoes it or reaches the learner.
 */
export async function sendTeacherQuestionEmail(input: TeacherQuestionEmail) {
  if (!isSmtpConfigured()) {
    console.warn(`[course-question] SMTP is not configured; ${input.teacherEmail} was not e-mailed about a new question.`);
    return "SKIPPED" as const;
  }
  const message = teacherQuestionMessage(input, env.APP_URL);
  try {
    await transport().sendMail({ from: env.SMTP_FROM, to: input.teacherEmail, ...message });
    return "SENT" as const;
  } catch (caught) {
    console.error(`[course-question] could not e-mail ${input.teacherEmail}:`, caught instanceof Error ? caught.message : caught);
    return "FAILED" as const;
  }
}

/**
 * Tell somebody they have been made a Teacher, with the link to sign in.
 * Best effort, like every other notice here: the role is already granted, so
 * a mail failure is logged and never undoes it.
 */
export async function sendTeacherRoleEmail(input: TeacherRoleEmail) {
  if (!isSmtpConfigured()) {
    console.warn(`[teacher-role] SMTP is not configured; ${input.email} was not told they are a teacher.`);
    return "SKIPPED" as const;
  }
  const message = teacherRoleMessage(input, env.APP_URL);
  try {
    await transport().sendMail({ from: env.SMTP_FROM, to: input.email, ...message });
    return "SENT" as const;
  } catch (caught) {
    console.error(`[teacher-role] could not e-mail ${input.email}:`, caught instanceof Error ? caught.message : caught);
    return "FAILED" as const;
  }
}

const TEACHER_EMAIL_CONCURRENCY = 5;

/**
 * E-mail everybody who has just been given the Teacher role.
 *
 * Callers pass only the people who did NOT already hold it, so re-saving a
 * form or re-uploading a classroom file never mails the same teacher twice.
 *
 * Sent after the response, in small batches: a classroom upload can name 50
 * teachers at once, and sending inside the request is exactly what made the
 * enrolment upload outlast the proxy and fail with "This page couldn't load".
 */
export function queueTeacherRoleEmails(userIds: Iterable<string>) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  after(async () => {
    const users = await db.user.findMany({
      where: { id: { in: ids } },
      select: { email: true, employee: { select: { name: true, email: true } } },
    });
    const recipients: TeacherRoleEmail[] = users.map((user) => ({
      name: user.employee?.name || user.email,
      email: user.employee?.email || user.email,
    }));
    for (let i = 0; i < recipients.length; i += TEACHER_EMAIL_CONCURRENCY) {
      await Promise.all(recipients.slice(i, i + TEACHER_EMAIL_CONCURRENCY).map((recipient) =>
        sendTeacherRoleEmail(recipient).catch((error) => {
          console.error(`[teacher-role] ${recipient.email}:`, error instanceof Error ? error.message : error);
        })));
    }
  });
}
