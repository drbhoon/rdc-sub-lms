import Link from "next/link";
import { UserRole } from "@prisma/client";
import { InactiveCourses } from "@/components/inactive-courses";
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
  const card = (course: (typeof courses)[number]) => <div className={`card course-card ${course.isActive ? "" : "inactive-card"}`} key={course.id}>
    <div className="badge-row"><span className="badge">{course.status.replaceAll("_", " ")}</span>{!course.isActive && <span className="badge badge-muted">Inactive</span>}</div>
    <h2><Link className="stretched-link" href={`/teacher/courses/${course.id}`}>{course.title}</Link></h2>
    <p className="muted">{course.category}</p>
    {/* Only an admin can act on the roster, so only an admin gets the link. */}
    <p>{course._count.contents} uploads - {isAdmin
      ? <Link className="count-link" href={`/admin/courses/${course.id}/learners`} title="See who is enrolled">{course._count.enrollments} learners</Link>
      : `${course._count.enrollments} learners`}</p>
  </div>;

  return <main className="container">
    <h1>Teacher</h1>
    <InactiveCourses count={inactive.length}>{inactive.map(card)}</InactiveCourses>
    <div className="grid">
      {active.map(card)}
      {!active.length && <p>{courses.length ? "No active courses." : "No courses are assigned to you."}</p>}
    </div>
  </main>;
}
