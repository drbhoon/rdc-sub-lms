import Link from "next/link";
import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

export default async function TeacherCourses() {
  const user = await requireRole(UserRole.TEACHER, UserRole.SUPER_ADMIN);
  const courses = await db.course.findMany({
    where: user.roles.some((r) => r.role === "SUPER_ADMIN") ? {} : { teachers: { some: { userId: user.id } } },
    include: { _count: { select: { enrollments: true, contents: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return <main className="container">
    <h1>Teaching</h1>
    <div className="grid">
      {courses.map((course) => <Link className={`card course-card ${course.isActive ? "" : "inactive-card"}`} key={course.id} href={`/teacher/courses/${course.id}`}>
        <div className="badge-row"><span className="badge">{course.status.replaceAll("_", " ")}</span>{!course.isActive && <span className="badge badge-muted">Inactive</span>}</div>
        <h2>{course.title}</h2>
        <p className="muted">{course.category}</p>
        <p>{course._count.contents} uploads - {course._count.enrollments} learners</p>
      </Link>)}
      {!courses.length && <p>No courses are assigned to you.</p>}
    </div>
  </main>;
}
