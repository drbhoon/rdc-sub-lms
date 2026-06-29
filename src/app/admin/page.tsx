import Link from "next/link";
import type { CSSProperties } from "react";
import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { buildLeaderboardRows, formatDuration } from "@/lib/leaderboard";
import { dateRangeWhere, getReportPeriod } from "@/lib/report-period";
import { requireRole } from "@/lib/session";

function PeriodFilter({ period }: { period: ReturnType<typeof getReportPeriod> }) {
  return <form className="period-filter card" method="get">
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
    db.enrollment.count({ where: { enrolledAt: periodRange } }),
    db.enrollment.count({ where: { enrolledAt: periodRange, status: "COMPLETED" } }),
    db.assessmentAttempt.findMany({
      where: { status: "SUBMITTED", submittedAt: periodRange, assessment: { course: { leaderboardEnabled: true } } },
      include: { employee: { include: { company: true } }, assessment: { include: { course: true } } },
      orderBy: [{ scorePercent: "desc" }, { timeTakenSeconds: "asc" }],
      take: 300,
    }),
    db.enrollment.findMany({
      where: { course: { leaderboardEnabled: true }, OR: [{ enrolledAt: periodRange }, { completedAt: periodRange }] },
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

  return <main className="container">
    <h1>Administration</h1>
    <PeriodFilter period={period} />
    <p className="muted">Overview shown for {period.label}.</p>

    <div className="grid">
      <div className="card"><div className="stat">{employees}</div><p>Active employees</p><Link className="button secondary" href="/admin/employees">Manage employees</Link></div>
      <div className="card"><div className="stat">{activeCourses}</div><p>Active courses</p><Link className="button secondary" href="/admin/courses">Manage courses</Link></div>
      <div className="card"><div className="stat">{inactiveCourses}</div><p>Inactive courses</p></div>
      <div className="card"><div className="stat">{coursesInPeriod}</div><p>Courses created in period</p></div>
    </div>

    <div className="two-col dashboard-row">
      <section className="card completion-card">
        <h2>Course completion rate</h2>
        <div className="completion-circle" style={{ "--percent": completionRate } as CSSProperties}><span>{completionRate}%</span></div>
        <p>{completedInPeriod} completed out of {enrollmentsInPeriod} learner enrolments in this period.</p>
      </section>
      <section className="card">
        <h2>Toppers</h2>
        <p className="muted">{assessmentLeaderboard.length ? "Formula: assessment score 70% + speed score 30%." : "Formula: progress score 70% + speed score 30%."}</p>
        <ol className="leaderboard-list">
          {leaderboard.map((row) => <li key={row.enrollmentId}>
            <strong>{row.employeeName}</strong>
            <span>{row.rankScore}% - {row.courseTitle} - {formatDuration(row.completionSeconds)}</span>
          </li>)}
        </ol>
        {!leaderboard.length && <p>No learner progress in this period.</p>}
      </section>
    </div>

    <section className="card">
      <h2>Reports and testing guide</h2>
      <p>Use reports for learner progress trackers, active learner lists, course analysis and period filters.</p>
      <p className="form-row"><Link className="button secondary" href="/admin/reports">Open reports</Link><a className="button secondary" href="/guides/rdc-lms-hr-admin-test-guide.docx">Download HR Admin test guide</a></p>
    </section>
  </main>;
}
