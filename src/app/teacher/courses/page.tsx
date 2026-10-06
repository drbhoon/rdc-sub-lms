import Link from "next/link";
import { UserRole } from "@prisma/client";
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

  return <main className="container">
    <h1>Teacher</h1>
    <div className="grid">
      {courses.map((course) => <div className={`card course-card ${course.isActive ? "" : "inactive-card"}`} key={course.id}>
        <div className="badge-row"><span className="badge">{course.status.replaceAll("_", " ")}</span>{!course.isActive && <span className="badge badge-muted">Inactive</span>}</div>
        <h2><Link className="stretched-link" href={`/teacher/courses/${course.id}`}>{course.title}</Link></h2>
        <p className="muted">{course.category}</p>
        {/* Only an admin can act on the roster, so only an admin gets the link. */}
        <p>{course._count.contents} uploads - {isAdmin
          ? <Link className="count-link" href={`/admin/courses/${course.id}/learners`} title="See who is enrolled">{course._count.enrollments} learners</Link>
          : `${course._count.enrollments} learners`}</p>
      </div>)}
      {!courses.length && <p>No courses are assigned to you.</p>}
    </div>
  </main>;
}
