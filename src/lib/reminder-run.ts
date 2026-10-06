import { CourseEmailType, EnrollmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { sendReminderEmail } from "@/lib/course-notifications";
import { reminderEnrollmentCutoff } from "@/lib/course-reminders";
import { learnersOnly } from "@/lib/teacher-preview";

const IST_OFFSET_MINUTES = 330;

function istDayRange(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const startIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const start = new Date(startIst - IST_OFFSET_MINUTES * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  return { start, end };
}

/**
 * Send today's course reminders: one e-mail per learner per course, to anyone
 * enrolled over a day ago who has not finished. Safe to run more than once a
 * day — the mail log is checked first, so nobody is reminded twice.
 *
 * Shared by the worker's daily schedule and the /api/cron/course-reminders
 * route, so the two can never disagree about who gets reminded.
 */
export async function runCourseReminders(now = new Date()) {
  const { start, end } = istDayRange(now);
  const enrollmentCutoff = reminderEnrollmentCutoff(now);
  const alreadyReminded = await db.courseEmailLog.findMany({
    where: { type: CourseEmailType.REMINDER, sentAt: { gte: start, lt: end } },
    select: { employeeId: true, courseId: true },
    take: 10000,
  });
  const sentToday = new Set(alreadyReminded.map((log) => `${log.employeeId}:${log.courseId}`));
  const enrollments = await db.enrollment.findMany({
    where: {
      status: { not: EnrollmentStatus.COMPLETED },
      // A teacher's preview of their own course is not an assignment to finish.
      ...learnersOnly,
      enrolledAt: { lte: enrollmentCutoff },
      employee: { status: "ACTIVE" },
      course: { status: "PUBLISHED" },
    },
    include: { employee: true, course: true },
    orderBy: { enrolledAt: "asc" },
    take: 1000,
  });

  let sent = 0;
  let skippedAlreadySent = 0;
  for (const enrollment of enrollments) {
    const key = `${enrollment.employeeId}:${enrollment.courseId}`;
    if (sentToday.has(key)) {
      skippedAlreadySent += 1;
      continue;
    }
    await sendReminderEmail({ employee: enrollment.employee, course: enrollment.course });
    sent += 1;
    sentToday.add(key);
  }

  return {
    sent,
    skippedAlreadySent,
    considered: enrollments.length,
    enrollmentCutoff: enrollmentCutoff.toISOString(),
    istDate: new Date(start.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10),
  };
}
