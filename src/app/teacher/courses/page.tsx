import Link from "next/link";
import { UserRole } from "@prisma/client";
import { InactiveCourses } from "@/components/inactive-courses";
import { coverFor } from "@/lib/course-cover";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { learnersOnly } from "@/lib/teacher-preview";

export default async function TeacherCourses() {
  const user = await requireRole(UserRole.TEACHER, UserRole.SUPER_ADMIN);
  const isAdmin = user.roles.some((r) => r.role === "SUPER_ADMIN");
  const courses = await db.course.findMany({
    where: isAdmin ? {} : { teachers: { some: { userId: user.id } } },
    include: { _count: { select: { enrollments: { where: learnersOnly }, contents: true } } },
    orderBy: { updatedAt: "desc" },
  });

  const active = courses.filter((course) => course.isActive);
  const inactive = courses.filter((course) => !course.isActive);
  const card = (course: (typeof courses)[number]) => <div className={`course-tile${course.isActive ? "" : " inactive-card"}`} key={course.id}>
    <div className="tile-cover" style={{ background: coverFor(course.title) }}>
      <span className="tile-category">{course.category}</span>
      <span className="tile-initial" aria-hidden="true">{course.title.charAt(0).toUpperCase()}</span>
    </div>
    <div className="tile-body">
      <h3><Link className="stretched-link" href={`/teacher/courses/${course.id}`}>{course.title}</Link></h3>
      {/* Only an admin can act on the roster, so only an admin gets the link. */}
      <p className="muted">{course._count.contents} uploads · {isAdmin
        ? <Link className="count-link" href={`/admin/courses/${course.id}/learners`} title="See who is enrolled">{course._count.enrollments} learners</Link>
        : `${course._count.enrollments} learners`}</p>
      <div className="tile-foot">
        <span className={`status-pill${course.status === "PUBLISHED" ? " status-completed" : ""}`}>{course.status.replaceAll("_", " ")}</span>
        {!course.isActive && <span className="status-pill">Inactive</span>}
      </div>
    </div>
  </div>;

  return <main className="container">
    <header className="home-head">
      <p className="muted">Courses you teach</p>
      <h1>Teacher</h1>
      <p><Link className="button secondary" href="/teacher/courses/ai">Create a course with AI</Link></p>
    </header>
    <InactiveCourses count={inactive.length}>{inactive.map(card)}</InactiveCourses>
    <div className="tile-grid">
      {active.map(card)}
      {!active.length && <p>{courses.length ? "No active courses." : "No courses are assigned to you."}</p>}
    </div>
  </main>;
}
