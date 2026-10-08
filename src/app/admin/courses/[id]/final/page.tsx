import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma, UserRole } from "@prisma/client";
import { AllowAttemptButton } from "@/components/allow-attempt-button";
import { FinalSchedulePanel, type ScheduleRow } from "@/components/final-schedule-panel";
import { withBase } from "@/lib/base-path";
import { db } from "@/lib/db";
import {
  activeFinalAssessment, emptyAttempts, loadFinalAttempts, loadFinalSchedules, NO_CLASSROOM, sittingForEnrollment,
} from "@/lib/final-schedule";
import { finalSitting, type FinalSchedule } from "@/lib/final-sitting";
import { formatIst } from "@/lib/ist";
import { requireRole } from "@/lib/session";
import { learnersOnly } from "@/lib/teacher-preview";

/** More than this on one page is not a list any more; the search narrows it. */
const PAGE_LIMIT = 2000;

const SHOW = [
  ["", "Everyone"],
  ["not_started", "Has not started it"],
  ["used", "Attempt used"],
  ["in_progress", "In progress"],
] as const;

function scheduleText(schedule: FinalSchedule | undefined) {
  if (!schedule) return "Not scheduled";
  return `Opens ${formatIst(schedule.opensAt)}${schedule.closesAt ? ` · closes ${formatIst(schedule.closesAt)}` : ""}`;
}

function roomStatus(schedule: FinalSchedule | undefined, now: Date): ScheduleRow["status"] {
  if (!schedule) return "NOT_SCHEDULED";
  const state = finalSitting({ now, schedule, attemptsUsed: 0, attemptsAllowed: 1, hasResumable: false, adminOpened: false }).state;
  return state === "SCHEDULED" || state === "OPEN" || state === "CLOSED" ? state : "NOT_SCHEDULED";
}

export default async function FinalAssessmentPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  await requireRole(UserRole.SUPER_ADMIN);
  const { id } = await params;
  const { q, show } = await searchParams;
  const query = (q ?? "").trim().slice(0, 100);
  const showFilter = SHOW.some(([value]) => value && value === show) ? show! : "";
  const now = new Date();

  const course = await db.course.findUnique({ where: { id }, select: { id: true, title: true } });
  if (!course) notFound();

  const [final, schedules, classrooms, unplaced, enrollments] = await Promise.all([
    activeFinalAssessment(id),
    loadFinalSchedules(id),
    db.classroom.findMany({
      where: { courseId: id },
      select: { id: true, name: true, _count: { select: { enrollments: { where: learnersOnly } } } },
      orderBy: { name: "asc" },
    }),
    db.enrollment.count({ where: { courseId: id, classroomId: null, ...learnersOnly } }),
    db.enrollment.findMany({
      where: {
        courseId: id,
        ...learnersOnly,
        ...(query ? { employee: { OR: [{ name: { contains: query, mode: Prisma.QueryMode.insensitive } }, { employeeCode: { contains: query, mode: Prisma.QueryMode.insensitive } }] } } : {}),
      },
      include: {
        employee: { select: { name: true, employeeCode: true } },
        classroom: { select: { name: true } },
      },
      orderBy: { employee: { name: "asc" } },
      take: PAGE_LIMIT,
    }),
  ]);

  const attempts = final ? await loadFinalAttempts(final.id, final.timeLimitSeconds, enrollments.map((enrollment) => enrollment.employeeId), now) : new Map();

  const rows: ScheduleRow[] = [
    ...classrooms.map((room) => ({
      key: room.id, name: room.name, learners: room._count.enrollments,
      scheduleText: scheduleText(schedules.get(room.id)), scheduled: schedules.has(room.id), status: roomStatus(schedules.get(room.id), now),
    })),
    // Learners placed in no classroom can only be scheduled as a group of their own.
    ...(unplaced > 0 || schedules.has(NO_CLASSROOM) ? [{
      key: NO_CLASSROOM, name: "Learners in no classroom", learners: unplaced,
      scheduleText: scheduleText(schedules.get(NO_CLASSROOM)), scheduled: schedules.has(NO_CLASSROOM), status: roomStatus(schedules.get(NO_CLASSROOM), now),
    }] : []),
  ];

  const learnerRows = enrollments.map((enrollment) => {
    const summary = attempts.get(enrollment.employeeId) ?? emptyAttempts;
    const sitting = sittingForEnrollment(enrollment, schedules, summary, now);
    return { enrollment, summary, sitting };
  }).filter(({ summary, sitting }) => {
    if (showFilter === "not_started") return summary.used === 0;
    if (showFilter === "used") return sitting.state === "USED";
    if (showFilter === "in_progress") return sitting.state === "RESUME";
    return true;
  });

  const stateText = (sitting: ReturnType<typeof sittingForEnrollment>) => {
    switch (sitting.state) {
      case "RESUME": return "In progress";
      case "USED": return "Attempt used";
      case "NOT_SCHEDULED": return "Not scheduled";
      case "SCHEDULED": return `Opens ${formatIst(sitting.opensAt)}`;
      case "OPEN": return "Open";
      case "CLOSED": return `Closed ${formatIst(sitting.closedAt)}`;
    }
  };

  const filtered = Boolean(query || showFilter);
  return <main className="container">
    <p><Link href={`/admin/courses/${course.id}`}>&larr; Back to the course</Link></p>
    <h1>{course.title}: final assessment sittings</h1>
    <p className="muted">
      The final assessment does not open by itself. Schedule it for a classroom and its learners can start it from the
      time you set. Each learner has one attempt; you can allow another to a particular learner below.
    </p>
    {!final && <p className="message">No final assessment is live yet. Build it from the course page first; schedules you set now will apply once it is.</p>}
    {final && <p>
      <span className="badge">Live</span> <strong>{final.title}</strong> · {final.questionsPerAttempt ?? final._count.questions} questions per learner · pass mark {final.passPercentage}% · {Math.round(final.timeLimitSeconds / 60)} minutes
    </p>}

    <section className="card">
      <h2>Schedule by classroom</h2>
      <FinalSchedulePanel courseId={course.id} rows={rows} />
    </section>

    <section className="card">
      <h2>Learners and attempts</h2>
      <p className="muted">
        An attempt counts from the moment it is started, even if the learner leaves the page. Allowing another attempt gives
        that learner exactly one more than they have used and lets them start straight away, whatever their class&apos;s schedule says.
      </p>
      <form className="employee-search" method="get" role="search">
        <input type="search" name="q" defaultValue={query} placeholder="Search by name or employee code" aria-label="Search learners" maxLength={100} />
        <select name="show" defaultValue={showFilter} aria-label="Show">
          {SHOW.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="submit">Search</button>
        {filtered && <a className="button secondary" href={withBase(`/admin/courses/${course.id}/final`)}>Clear</a>}
      </form>
      <div className="table-wrap"><table>
        <thead><tr><th>Learner</th><th>Classroom</th><th>Final assessment</th><th>Attempts</th><th>Result</th><th></th></tr></thead>
        <tbody>
          {learnerRows.map(({ enrollment, summary, sitting }) => {
            const exhausted = summary.used >= enrollment.finalAttemptsAllowed;
            const canOpen = sitting.state === "NOT_SCHEDULED" || sitting.state === "SCHEDULED" || sitting.state === "CLOSED";
            const label = exhausted ? "Allow another attempt" : canOpen ? "Let them start now" : null;
            return <tr key={enrollment.id}>
              <td><strong>{enrollment.employee.name}</strong><br /><span className="muted">{enrollment.employee.employeeCode}</span></td>
              <td>{enrollment.classroom?.name ?? <span className="muted">None</span>}</td>
              <td>{stateText(sitting)}{enrollment.finalAdminOpened && sitting.state === "OPEN" && <><br /><span className="muted">Allowed by an admin</span></>}</td>
              <td>{summary.used} of {enrollment.finalAttemptsAllowed}{summary.abandoned > 0 && <><br /><span className="muted">{summary.abandoned} not submitted</span></>}</td>
              <td>{summary.bestScore !== null ? <><strong>{summary.bestScore}%</strong> <span className="badge">{summary.passed ? "Passed" : "Not passed"}</span></> : <span className="muted">-</span>}</td>
              <td>{final && label && <AllowAttemptButton enrollmentId={enrollment.id} learner={enrollment.employee.name} label={label} />}</td>
            </tr>;
          })}
          {!learnerRows.length && <tr><td colSpan={6}>No learners match.</td></tr>}
        </tbody>
      </table></div>
      <p className="muted">{learnerRows.length} learner{learnerRows.length === 1 ? "" : "s"} shown.{enrollments.length >= PAGE_LIMIT && " Narrow the search to see the rest."}</p>
    </section>
  </main>;
}
