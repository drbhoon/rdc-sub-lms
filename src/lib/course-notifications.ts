import nodemailer from "nodemailer";
import { CourseEmailStatus, CourseEmailType, type Course, type Employee } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

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
