import { UserRole } from "@prisma/client";
import type { CSSProperties } from "react";
import { db } from "@/lib/db";
import { buildLeaderboardRows, formatDuration } from "@/lib/leaderboard";
import { dateRangeWhere, getReportPeriod } from "@/lib/report-period";
import { requireRole } from "@/lib/session";

function getValue(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value ?? "";
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(UserRole.SUPER_ADMIN);
  const params = await searchParams;
  const period = getReportPeriod(params);
  const periodRange = dateRangeWhere(period);
  const courseId = getValue(params, "courseId");
  const companyId = getValue(params, "companyId");
  const exportParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => exportParams.append(key, item));
    else if (value) exportParams.set(key, value);
  }

  const [courses, companies] = await Promise.all([
    db.course.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true } }),
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const [progressRows, activeLearners, courseAnalysis] = await Promise.all([
    db.enrollment.findMany({
      where: {
        enrolledAt: periodRange,
        ...(courseId ? { courseId } : {}),
        ...(companyId ? { employee: { companyId } } : {}),
      },
      include: {
        employee: { include: { company: true } },
        progress: true,
        course: { include: { contents: { where: { isPublished: true }, include: { lessons: { where: { approvedAt: { not: null } } } } } } },
      },
      orderBy: [{ course: { title: "asc" } }, { employee: { name: "asc" } }],
      take: 500,
    }),
    db.employee.findMany({
      where: { status: "ACTIVE", ...(companyId ? { companyId } : {}) },
      include: { company: true },
      orderBy: [{ company: { name: "asc" } }, { name: "asc" }],
      take: 500,
    }),
    db.course.findMany({
      where: { ...(courseId ? { id: courseId } : {}), ...(companyId ? { companies: { some: { companyId } } } : {}) },
      include: {
        companies: { include: { company: true } },
        enrollments: { include: { progress: true } },
        contents: { where: { isPublished: true }, include: { lessons: { where: { approvedAt: { not: null } } } } },
      },
      orderBy: { title: "asc" },
      take: 200,
    }),
  ]);

  const completionRate = progressRows.length ? Math.round(progressRows.filter((row) => row.status === "COMPLETED").length / progressRows.length * 100) : 0;
  const leaderboard = buildLeaderboardRows(progressRows.map((enrollment) => {
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
  }), 20);

  return <main className="container">
    <h1>Reports</h1>
    <form className="period-filter card" method="get">
      <label>Period
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
      <label>Course
        <select name="courseId" defaultValue={courseId}>
          <option value="">All courses</option>
          {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
        </select>
      </label>
      <label>Company
        <select name="companyId" defaultValue={companyId}>
          <option value="">All companies</option>
          {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select>
      </label>
      <button>Apply</button>
      <a className="button secondary" href={`/api/reports/export?${exportParams.toString()}`}>Download Excel</a>
    </form>

    <div className="grid">
      <div className="card"><div className="stat">{progressRows.length}</div><p>Learner-course records in period</p></div>
      <div className="card"><div className="stat">{activeLearners.length}</div><p>Active learners</p></div>
      <div className="card completion-card"><div className="completion-circle small" style={{ "--percent": completionRate } as CSSProperties}><span>{completionRate}%</span></div><p>Completion rate</p></div>
    </div>

    <section className="card">
      <h2>Progress tracker</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Learner</th><th>Company</th><th>Course</th><th>Status</th><th>Progress</th><th>Completed</th></tr></thead>
        <tbody>
          {progressRows.map((enrollment) => {
            const totalLessons = enrollment.course.contents.flatMap((content) => content.lessons).length;
            const completedLessons = enrollment.progress.filter((progress) => progress.completedAt).length;
            const percent = totalLessons ? Math.round(completedLessons / totalLessons * 100) : 0;
            return <tr key={enrollment.id}>
              <td><strong>{enrollment.employee.name}</strong><br /><span className="muted">{enrollment.employee.employeeCode}</span></td>
              <td>{enrollment.employee.company.name}</td>
              <td>{enrollment.course.title}</td>
              <td><span className="badge">{enrollment.status.replaceAll("_", " ")}</span></td>
              <td>{completedLessons}/{totalLessons} lessons ({percent}%)</td>
              <td>{enrollment.completedAt ? enrollment.completedAt.toLocaleDateString("en-IN") : "-"}</td>
            </tr>;
          })}
          {!progressRows.length && <tr><td colSpan={6}>No learner-course records match this filter.</td></tr>}
        </tbody>
      </table></div>
    </section>

    <section className="card">
      <h2>Active learners</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Employee code</th><th>Company</th><th>Designation</th><th>Location/Plant</th></tr></thead>
        <tbody>
          {activeLearners.map((employee) => <tr key={employee.id}>
            <td>{employee.name}</td>
            <td>{employee.employeeCode}</td>
            <td>{employee.company.name}</td>
            <td>{employee.designation}</td>
            <td>{employee.locationPlant ?? "-"}</td>
          </tr>)}
          {!activeLearners.length && <tr><td colSpan={5}>No active learners match this filter.</td></tr>}
        </tbody>
      </table></div>
    </section>

    <section className="card">
      <h2>Course analysis</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Course</th><th>Companies</th><th>Status</th><th>Active</th><th>Enrolled</th><th>Completed</th><th>Completion rate</th></tr></thead>
        <tbody>
          {courseAnalysis.map((course) => {
            const enrolled = course.enrollments.length;
            const completed = course.enrollments.filter((enrollment) => enrollment.status === "COMPLETED").length;
            const rate = enrolled ? Math.round(completed / enrolled * 100) : 0;
            return <tr key={course.id}>
              <td>{course.title}</td>
              <td>{course.companies.map((company) => company.company.name).join(", ")}</td>
              <td><span className="badge">{course.status.replaceAll("_", " ")}</span></td>
              <td>{course.isActive ? "Active" : "Inactive"}</td>
              <td>{enrolled}</td>
              <td>{completed}</td>
              <td>{rate}%</td>
            </tr>;
          })}
          {!courseAnalysis.length && <tr><td colSpan={7}>No courses match this filter.</td></tr>}
        </tbody>
      </table></div>
    </section>

    <section className="card">
      <h2>Toppers</h2>
      <p className="muted">Formula: progress score 70% + speed score 30%. Speed is normalized within each course.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Rank</th><th>Learner</th><th>Course</th><th>Score</th><th>Progress score</th><th>Speed score</th><th>Completion time</th></tr></thead>
        <tbody>
          {leaderboard.map((row, index) => <tr key={row.enrollmentId}>
            <td>{index + 1}</td>
            <td>{row.employeeName}<br /><span className="muted">{row.employeeCode}</span></td>
            <td>{row.courseTitle}</td>
            <td><strong>{row.rankScore}%</strong></td>
            <td>{row.progressScore}%</td>
            <td>{row.speedScore}%</td>
            <td>{formatDuration(row.completionSeconds)}</td>
          </tr>)}
          {!leaderboard.length && <tr><td colSpan={7}>No topper data is available for this filter.</td></tr>}
        </tbody>
      </table></div>
    </section>
  </main>;
}
