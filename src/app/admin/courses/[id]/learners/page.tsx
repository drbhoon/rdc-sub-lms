import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma, UserRole } from "@prisma/client";
import { LearnerRoster, type RosterRow } from "@/components/learner-roster";
import { withBase } from "@/lib/base-path";
import { db } from "@/lib/db";
import { formatIstDate } from "@/lib/ist";
import { requireRole } from "@/lib/session";
import { learnersOnly } from "@/lib/teacher-preview";

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

  const filtered = Boolean(query || statusFilter);
  return <main className="container">
    <p><Link href={`/admin/courses/${course.id}`}>&larr; Back to the course</Link></p>
    <h1>{course.title}: enrolled learners</h1>
    <p className="muted">
      {filtered ? `${matching} of ${total} learners match.` : `${total} learner${total === 1 ? "" : "s"} enrolled.`}
      {matching > rows.length && ` Showing the first ${rows.length}; narrow the search to see the rest.`}
    </p>

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
