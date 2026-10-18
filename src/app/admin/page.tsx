import { withBase } from "@/lib/base-path";
import Link from "next/link";
import { BarChart3, BookCheck, BookX, FilePlus2, FileText, LayoutDashboard, Users, type LucideIcon } from "lucide-react";
import { AdminHero, StatTile, toneAt } from "@/components/admin-ui";
import { ProgressRing } from "@/components/progress-ring";
import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { buildLeaderboardRows, formatDuration } from "@/lib/leaderboard";
import { dateRangeWhere, getReportPeriod } from "@/lib/report-period";
import { requireRole } from "@/lib/session";
import { learnersOnly, notTeacherAttempt } from "@/lib/teacher-preview";

function PeriodFilter({ period }: { period: ReturnType<typeof getReportPeriod> }) {
  return <form className="hero-filter" method="get">
    <label>Overview period
      <select name="period" defaultValue={period.key}>
        <option value="today">Today</option>
        <option value="yesterday">Yesterday</option>
        <option value="week">Week</option>
        <option value="month">Month</option>
        <option value="year">Year</option>
        <option value="custom">Custom period</option>
      </select>
    </label>
    <label>From<input type="date" name="from" defaultValue={period.fromInput} /></label>
    <label>To<input type="date" name="to" defaultValue={period.toInput} /></label>
    <button>Apply</button>
  </form>;
}

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(UserRole.SUPER_ADMIN);
  const period = getReportPeriod(await searchParams);
  const periodRange = dateRangeWhere(period);
  const [employees, activeCourses, inactiveCourses, coursesInPeriod, enrollmentsInPeriod, completedInPeriod, leaderboardAttempts, leaderboardEnrollments] = await Promise.all([
    db.employee.count({ where: { status: "ACTIVE" } }),
    db.course.count({ where: { isActive: true } }),
    db.course.count({ where: { isActive: false } }),
    db.course.count({ where: { createdAt: periodRange } }),
    db.enrollment.count({ where: { enrolledAt: periodRange, ...learnersOnly } }),
    db.enrollment.count({ where: { enrolledAt: periodRange, status: "COMPLETED", ...learnersOnly } }),
    db.assessmentAttempt.findMany({
      where: { status: "SUBMITTED", submittedAt: periodRange, assessment: { course: { leaderboardEnabled: true } }, ...notTeacherAttempt },
      include: { employee: { include: { company: true } }, assessment: { include: { course: true } } },
      orderBy: [{ scorePercent: "desc" }, { timeTakenSeconds: "asc" }],
      take: 300,
    }),
    db.enrollment.findMany({
      where: { course: { leaderboardEnabled: true }, OR: [{ enrolledAt: periodRange }, { completedAt: periodRange }], ...learnersOnly },
      include: {
        employee: { include: { company: true } },
        progress: true,
        course: { include: { contents: { where: { isPublished: true }, include: { lessons: { where: { approvedAt: { not: null } } } } } } },
      },
      take: 300,
    }),
  ]);
  const completionRate = enrollmentsInPeriod ? Math.round(completedInPeriod / enrollmentsInPeriod * 100) : 0;
  const assessmentLeaderboard = buildLeaderboardRows(leaderboardAttempts.map((attempt) => ({
    enrollmentId: attempt.id,
    courseId: attempt.assessment.courseId,
    courseTitle: attempt.assessment.course.title,
    employeeCode: attempt.employee.employeeCode,
    employeeName: attempt.employee.name,
    companyName: attempt.employee.company.name,
    enrolledAt: attempt.startedAt,
    startedAt: attempt.startedAt,
    completedAt: attempt.submittedAt,
    totalLessons: 100,
    completedLessons: 0,
    assessmentScorePercent: attempt.scorePercent,
    completionSecondsOverride: attempt.timeTakenSeconds,
  })), 5);
  const progressLeaderboard = buildLeaderboardRows(leaderboardEnrollments.map((enrollment) => {
    const totalLessons = enrollment.course.contents.flatMap((content) => content.lessons).length;
    return {
      enrollmentId: enrollment.id,
      courseId: enrollment.courseId,
      courseTitle: enrollment.course.title,
      employeeCode: enrollment.employee.employeeCode,
      employeeName: enrollment.employee.name,
      companyName: enrollment.employee.company.name,
      enrolledAt: enrollment.enrolledAt,
      startedAt: enrollment.startedAt,
      completedAt: enrollment.completedAt,
      totalLessons,
      completedLessons: enrollment.progress.filter((progress) => progress.completedAt).length,
    };
  }), 5);
  const leaderboard = assessmentLeaderboard.length ? assessmentLeaderboard : progressLeaderboard;

  const kpis: { icon: LucideIcon; value: number; label: string; href?: string }[] = [
    { icon: Users, value: employees, label: "Active employees", href: "/admin/employees" },
    { icon: BookCheck, value: activeCourses, label: "Active courses", href: "/admin/courses" },
    { icon: BookX, value: inactiveCourses, label: "Inactive courses" },
    { icon: FilePlus2, value: coursesInPeriod, label: "Courses created in period" },
  ];

  return <main className="container">
    <AdminHero icon={LayoutDashboard} title="Administration" subtitle={`Overview shown for ${period.label}`}>
      <PeriodFilter period={period} />
    </AdminHero>

    <div className="stat-grid">
      {kpis.map(({ icon, value, label, href }, index) => <StatTile key={label} icon={icon} value={value} label={href ? `${label} · Manage` : label} tone={toneAt(index)} href={href} />)}
    </div>

    <div className="two-col dashboard-row">
      <section className="card completion-card">
        <h2>Course completion rate</h2>
        <ProgressRing percent={completionRate} size={170} stroke={18} label={`${completionRate}% completion rate`} />
        <p>{completedInPeriod} completed out of {enrollmentsInPeriod} learner enrolments in this period.</p>
      </section>
      <section className="card">
        <h2>Toppers</h2>
        <p className="muted">{assessmentLeaderboard.length ? "Formula: assessment score 70% + speed score 30%." : "Formula: progress score 70% + speed score 30%."}</p>
        <ol className="leaderboard-list ranked">
          {leaderboard.map((row) => <li key={row.enrollmentId}>
            <strong>{row.employeeName}</strong>
            <span>{row.rankScore}% - {row.courseTitle} - {formatDuration(row.completionSeconds)}</span>
          </li>)}
        </ol>
        {!leaderboard.length && <p>No learner progress in this period.</p>}
      </section>
    </div>

    <div className="action-tiles">
      <Link className="action-tile" href="/admin/reports">
        <span className="action-icon"><BarChart3 size={24} aria-hidden="true" /></span>
        <div><strong>Open reports</strong><span>Progress trackers, active learners, course analysis, custom reports and the infographic.</span></div>
      </Link>
      <a className="action-tile" href={withBase("/guides/rdc-lms-hr-admin-test-guide.docx")}>
        <span className="action-icon"><FileText size={24} aria-hidden="true" /></span>
        <div><strong>HR Admin test guide</strong><span>Download the step-by-step guide for testing the LMS.</span></div>
      </a>
    </div>
  </main>;
}
