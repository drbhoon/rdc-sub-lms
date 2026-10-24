import { Users } from "lucide-react";
import { AdminHero } from "@/components/admin-ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma, UserRole } from "@prisma/client";
import { LearnerRoster, type RosterRow } from "@/components/learner-roster";
import { withBase } from "@/lib/base-path";
import { db } from "@/lib/db";
import { formatIstDate } from "@/lib/ist";
import { requireRole } from "@/lib/session";
import { learnersOnly } from "@/lib/teacher-preview";
import { ScormResetButton } from "@/components/scorm-reset-button";
import { MAX_SCORM_ATTEMPTS, outcomeOf } from "@/lib/scorm-runtime";

/** More than this on one page is not a roster any more; the search narrows it. */
const PAGE_LIMIT = 2000;

const STATUSES = [
  ["", "All"],
  ["NOT_STARTED", "Not started"],
  ["IN_PROGRESS", "In progress"],
  ["COMPLETED", "Completed"],
] as const;

function learnerSearch(query: string): Prisma.EnrollmentWhereInput {
  if (!query) return {};
  const like = { contains: query, mode: Prisma.QueryMode.insensitive };
  return { employee: { OR: [{ name: like }, { employeeCode: like }, { email: like }, { designation: like }, { company: { name: like } }] } };
}

export default async function CourseLearnersPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requireRole(UserRole.SUPER_ADMIN);
  const { id } = await params;
  const { q, status } = await searchParams;
  const query = (q ?? "").trim().slice(0, 100);
  const statusFilter = STATUSES.some(([value]) => value && value === status) ? status! : "";

  const course = await db.course.findUnique({
    where: { id },
    select: {
      id: true, title: true,
      contents: { where: { isPublished: true }, select: { lessons: { where: { approvedAt: { not: null } }, select: { id: true } } } },
    },
  });
  if (!course) notFound();
  const totalLessons = course.contents.reduce((sum, content) => sum + content.lessons.length, 0);

  const where: Prisma.EnrollmentWhereInput = {
    courseId: id,
    ...learnersOnly,
    ...(statusFilter ? { status: statusFilter as "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" } : {}),
    ...learnerSearch(query),
  };
  const [enrollments, matching, total, previews] = await Promise.all([
    db.enrollment.findMany({
      where,
      include: {
        employee: { select: { name: true, employeeCode: true, email: true, company: { select: { name: true } } } },
        classroom: { select: { name: true } },
        progress: { select: { completedAt: true } },
        _count: { select: { assessmentAttempts: true } },
      },
      orderBy: { employee: { name: "asc" } },
      take: PAGE_LIMIT,
    }),
    db.enrollment.count({ where }),
    db.enrollment.count({ where: { courseId: id, ...learnersOnly } }),
    // Teachers looking at their own course. Not learners, so not in the roster
    // or the count - listed so nobody wonders where they went.
    db.enrollment.findMany({
      where: { courseId: id, isTeacherPreview: true },
      select: { employee: { select: { name: true, employeeCode: true } } },
      orderBy: { employee: { name: "asc" } },
    }),
  ]);

  const rows: RosterRow[] = enrollments.map((enrollment) => ({
    enrollmentId: enrollment.id,
    name: enrollment.employee.name,
    employeeCode: enrollment.employee.employeeCode,
    email: enrollment.employee.email,
    company: enrollment.employee.company.name,
    classroom: enrollment.classroom?.name ?? null,
    enrolledOn: formatIstDate(enrollment.enrolledAt),
    status: enrollment.status,
    lessonsDone: enrollment.progress.filter((item) => item.completedAt).length,
    totalLessons,
    quizAttempts: enrollment._count.assessmentAttempts,
  }));

  // A SCORM course: who has used how many of their attempts, and a way to give them more.
  const scormLessons = await db.lesson.findMany({
    where: { type: "SCORM", content: { courseId: id } },
    select: { id: true, title: true },
  });
  const scormRows = scormLessons.length
    ? await db.scormAttempt.findMany({
        where: { lessonId: { in: scormLessons.map((lesson) => lesson.id) }, enrollmentId: { in: enrollments.map((enrollment) => enrollment.id) } },
        orderBy: [{ enrollmentId: "asc" }, { attemptNumber: "asc" }],
      })
    : [];
  const scormByLearner = new Map<string, typeof scormRows>();
  for (const attempt of scormRows) scormByLearner.set(`${attempt.enrollmentId}:${attempt.lessonId}`, [...(scormByLearner.get(`${attempt.enrollmentId}:${attempt.lessonId}`) ?? []), attempt]);

  const filtered = Boolean(query || statusFilter);
  return <main className="container">
    <p><Link href={`/admin/courses/${course.id}`}>&larr; Back to the course</Link></p>
    <AdminHero icon={Users} title={`${course.title}: enrolled learners`}
      subtitle={`${filtered ? `${matching} of ${total} learners match.` : `${total} learner${total === 1 ? "" : "s"} enrolled.`}${matching > rows.length ? ` Showing the first ${rows.length}; narrow the search to see the rest.` : ""}`} />

    <section className="card">
      <form className="employee-search" method="get" role="search">
        <input type="search" name="q" defaultValue={query} placeholder="Search by name, employee code, e-mail, company or designation" aria-label="Search learners" maxLength={100} />
        <select name="status" defaultValue={statusFilter} aria-label="Status">
          {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="submit">Search</button>
        {filtered && <a className="button secondary" href={withBase(`/admin/courses/${course.id}/learners`)}>Clear</a>}
      </form>
      <LearnerRoster courseId={course.id} rows={rows} />
    </section>

    {scormLessons.length > 0 && <section className="card">
      <h2>SCORM attempts</h2>
      <p className="muted">Each learner has {MAX_SCORM_ATTEMPTS} attempts; the course&apos;s own pass or fail is final. Reset gives someone two new attempts and keeps the old ones on record.</p>
      {scormLessons.map((lesson) => <div key={lesson.id} className="table-wrap">
        <table>
          <thead><tr><th>Learner</th><th>Attempts used</th><th>Best score</th><th>Result</th><th /></tr></thead>
          <tbody>
            {enrollments.map((enrollment) => {
              const attempts = (scormByLearner.get(`${enrollment.id}:${lesson.id}`) ?? []).filter((attempt) => !attempt.resetAt);
              const passed = attempts.some((attempt) => outcomeOf(attempt) === "passed");
              const last = attempts[attempts.length - 1];
              const best = attempts.reduce<number | null>((top, attempt) => (attempt.scoreRaw !== null && (top === null || attempt.scoreRaw > top) ? attempt.scoreRaw : top), null);
              if (!(scormByLearner.get(`${enrollment.id}:${lesson.id}`) ?? []).length) return null;
              return <tr key={enrollment.id}>
                <td>{enrollment.employee.name} <span className="muted">({enrollment.employee.employeeCode})</span></td>
                <td>{attempts.length} of {MAX_SCORM_ATTEMPTS}</td>
                <td>{best === null ? "-" : Math.round(best)}</td>
                <td>{passed ? "Passed" : last ? (last.finished ? "Failed" : "In progress") : "Reset"}</td>
                <td><ScormResetButton enrollmentId={enrollment.id} lessonId={lesson.id} name={enrollment.employee.name} passed={passed} /></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>)}
    </section>}

    {previews.length > 0 && <section className="card">
      <h2>Teachers viewing this course</h2>
      <p className="muted">
        Teachers are enrolled on the courses they teach so they can see them the way a learner does. They are not
        counted as learners and do not appear in results, toppers, reports or reminders.
      </p>
      <p>{previews.map((preview) => `${preview.employee.name} (${preview.employee.employeeCode})`).join(", ")}</p>
    </section>}
  </main>;
}
