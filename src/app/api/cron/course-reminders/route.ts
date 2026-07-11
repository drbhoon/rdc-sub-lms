import { CourseEmailType, EnrollmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendReminderEmail } from "@/lib/course-notifications";

const IST_OFFSET_MINUTES = 330;

function istDayRange(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const startIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const start = new Date(startIst - IST_OFFSET_MINUTES * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  return { start, end };
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return "";
}

function isAuthorized(request: Request) {
  if (!env.CRON_SECRET) return process.env.NODE_ENV !== "production";
  const url = new URL(request.url);
  const token = request.headers.get("x-cron-secret") || bearerToken(request) || url.searchParams.get("secret");
  return token === env.CRON_SECRET;
}

export async function GET(request: Request) {
  if (!env.CRON_SECRET && process.env.NODE_ENV === "production") return new Response("CRON_SECRET is required in production", { status: 503 });
  if (!isAuthorized(request)) return new Response("Forbidden", { status: 403 });

  const { start, end } = istDayRange();
  const alreadyReminded = await db.courseEmailLog.findMany({
    where: { type: CourseEmailType.REMINDER, sentAt: { gte: start, lt: end } },
    select: { employeeId: true, courseId: true },
    take: 10000,
  });
  const sentToday = new Set(alreadyReminded.map((log) => `${log.employeeId}:${log.courseId}`));
  const enrollments = await db.enrollment.findMany({
    where: {
      status: { not: EnrollmentStatus.COMPLETED },
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

  return Response.json({
    status: "ok",
    sent,
    skippedAlreadySent,
    considered: enrollments.length,
    istDate: new Date(start.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10),
  });
}
