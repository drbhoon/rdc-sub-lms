import { timingSafeEqual } from "node:crypto";
import { EnrollmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { learnersOnly } from "@/lib/teacher-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/employee-portal/tasks
 *
 * Asked by the HR portal, over the private network, when an employee opens
 * hr.rdcc.ai/employees: "which courses has this person still to finish?"
 *
 *   header  x-master-key: <MASTER_API_KEY>   (the key the apps already share)
 *   body    { "email": "someone@rdc.in", "employee_code": "A00123" }
 *
 * The rule is the one the daily reminder uses (lib/reminder-run.ts): enrolled
 * as a learner, course published, not completed, person active. It does not
 * wait a day after enrolment as the reminder does, since a list is not a nag.
 *
 * Only titles, status and links go back: no scores, no answers. Not for
 * browsers, which is why it takes a key and not a session.
 */

/** Constant time, and an unset key never means "everyone passes". */
function keyMatches(presented: string | null): boolean {
  const expected = process.env.MASTER_API_KEY;
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, private" } });
}

export async function POST(request: Request) {
  if (!keyMatches(request.headers.get("x-master-key"))) return json({ error: "Not authorised" }, 401);

  let body: { email?: unknown; employee_code?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  const email = String(body?.email ?? "").trim().toLowerCase();
  const employeeCode = String(body?.employee_code ?? "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "email is required." }, 400);

  try {
    // The address is what they sign in to the LMS with, so it decides. The
    // employee code is only tried when no learner has that address: a record
    // typed in here before the master sync may carry a different one.
    const current = { status: "ACTIVE" as const, archivedAt: null };
    let learners = await db.employee.findMany({
      where: { ...current, email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (!learners.length && employeeCode) {
      learners = await db.employee.findMany({
        where: { ...current, employeeCode: { equals: employeeCode, mode: "insensitive" } },
        select: { id: true },
      });
    }
    if (!learners.length) return json({ app: "lms", groups: [] });

    const enrollments = await db.enrollment.findMany({
      where: {
        employeeId: { in: learners.map((learner) => learner.id) },
        status: { not: EnrollmentStatus.COMPLETED },
        // A teacher's preview of their own course is not an assignment to finish.
        ...learnersOnly,
        course: { status: "PUBLISHED" },
      },
      select: {
        status: true,
        enrolledAt: true,
        course: { select: { id: true, title: true, durationMinutes: true } },
      },
      orderBy: { enrolledAt: "asc" },
      take: 200,
    });
    if (!enrollments.length) return json({ app: "lms", groups: [] });

    const base = env.APP_URL.replace(/\/$/, "");
    return json({
      app: "lms",
      groups: [
        {
          title: "Courses to complete",
          detail: null,
          url: `${base}/learn/courses`,
          urlLabel: "Open my courses",
          items: enrollments.map((enrollment) => ({
            title: enrollment.course.title,
            detail: `${enrollment.status === EnrollmentStatus.IN_PROGRESS ? "In progress" : "Not started"} · ${enrollment.course.durationMinutes} minutes`,
            url: `${base}/learn/courses/${enrollment.course.id}`,
            since: enrollment.enrolledAt.toISOString(),
          })),
        },
      ],
    });
  } catch (error) {
    console.error("[employee-portal/tasks]", error);
    return json({ error: "Internal server error" }, 500);
  }
}
