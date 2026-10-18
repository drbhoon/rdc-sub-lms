import Link from "next/link";
import { UserRole } from "@prisma/client";
import { createCourse } from "@/actions/courses";
import { ActionForm } from "@/components/action-form";
import { CollapsibleCard } from "@/components/collapsible-card";
import { coverFor } from "@/lib/course-cover";
import { InactiveCourses } from "@/components/inactive-courses";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { eligibleTeacherWhere } from "@/lib/teacher-eligibility";
import { learnersOnly } from "@/lib/teacher-preview";

export default async function CoursesPage() {
  await requireRole(UserRole.SUPER_ADMIN);
  const [courses, companies, teachers] = await Promise.all([
    db.course.findMany({
      include: {
        teachers: { include: { user: { include: { employee: true } } } },
        companies: { include: { company: true } },
        _count: { select: { enrollments: { where: learnersOnly }, contents: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.company.findMany({ orderBy: { name: "asc" } }),
    db.user.findMany({
      where: eligibleTeacherWhere(),
      include: { employee: true },
      orderBy: [{ employee: { name: "asc" } }, { email: "asc" }],
    }),
  ]);

  const active = courses.filter((course) => course.isActive);
  const inactive = courses.filter((course) => !course.isActive);
  const card = (course: (typeof courses)[number]) => <div className={`course-tile${course.isActive ? "" : " inactive-card"}`} key={course.id}>
    <div className="tile-cover" style={{ background: coverFor(course.title) }}>
      <span className="tile-category">{course.category}</span>
      <span className="tile-initial" aria-hidden="true">{course.title.charAt(0).toUpperCase()}</span>
    </div>
    <div className="tile-body">
      {/* The title link stretches over the whole tile, so the tile still opens
          the course; the learner count is its own link and sits above it. */}
      <h3><Link className="stretched-link" href={`/admin/courses/${course.id}`}>{course.title}</Link></h3>
      <p className="muted">{course.durationMinutes} minutes · {course.companies.map((c) => c.company.name).join(", ")}</p>
      <p className="muted">{course._count.contents} uploads · <Link className="count-link" href={`/admin/courses/${course.id}/learners`} title="See who is enrolled">{course._count.enrollments} learners</Link></p>
      {!course.teachers.length && <p className="muted">No teacher assigned yet.</p>}
      <div className="tile-foot">
        <span className={`status-pill${course.status === "PUBLISHED" ? " status-completed" : ""}`}>{course.status.replaceAll("_", " ")}</span>
        {!course.isActive && <span className="status-pill">Inactive</span>}
      </div>
    </div>
  </div>;

  return <main className="container">
    <h1>Courses</h1>
    <div className="two-col">
      <section className="card">
        <h2>Course catalogue</h2>
        <InactiveCourses count={inactive.length}>{inactive.map(card)}</InactiveCourses>
        <div className="tile-grid">
          {active.map(card)}
          {!active.length && <p>{courses.length ? "No active courses." : "No courses created."}</p>}
        </div>
      </section>

      <aside>
        <CollapsibleCard title="Create course" summary="add a draft course">
        {!companies.length ? <p>Import employees first so companies are available.</p> : <ActionForm action={createCourse} submitLabel="Create draft course">
          <label>Course title<input name="title" required /></label>
          <label>Category<input name="category" required /></label>
          <label>Description<textarea name="description" required /></label>
          <div className="form-row">
            <label>Duration (minutes)<input name="durationMinutes" type="number" min="1" defaultValue="60" /></label>
            <label>Pass percentage<input name="passPercentage" type="number" min="1" max="100" defaultValue="70" /></label>
          </div>
          <label>AI token allowance<input name="aiTokenLimit" type="number" min="0" defaultValue="50000" /></label>
          <fieldset>
            <legend>Assigned teachers (optional)</legend>
            {teachers.length ? teachers.map((teacher) => <label className="checkbox" key={teacher.id}>
              <input type="checkbox" name="teacherIds" value={teacher.id} />{teacher.employee?.name ?? teacher.email}
            </label>) : <p className="muted">No teachers are available yet. You can assign teachers later.</p>}
          </fieldset>
          <fieldset>
            <legend>Applicable companies</legend>
            {companies.map((company) => <label className="checkbox" key={company.id}>
              <input type="checkbox" name="companyIds" value={company.id} />{company.name}
            </label>)}
          </fieldset>
          <label className="checkbox"><input type="checkbox" name="certificateEnabled" defaultChecked />Certificate enabled</label>
          <label className="checkbox"><input type="checkbox" name="leaderboardEnabled" defaultChecked />Leaderboard enabled</label>
        </ActionForm>}
        </CollapsibleCard>
      </aside>
    </div>
  </main>;
}
