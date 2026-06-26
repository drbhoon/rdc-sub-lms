import Link from "next/link";
import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

export default async function MyCourses() {
  const user = await requireRole(UserRole.LEARNER);
  if (!user.employeeId) return null;
  const enrollments = await db.enrollment.findMany({
    where: { employeeId: user.employeeId, course: { status: "PUBLISHED" } },
    include: { course: { include: { contents: { where: { isPublished: true }, include: { lessons: true } } } }, progress: true },
    orderBy: { enrolledAt: "desc" },
  });

  return <main className="container">
    <h1>My courses</h1>
    <div className="grid">
      {enrollments.map((enrollment) => {
        const total = enrollment.course.contents.flatMap((content) => content.lessons).filter((lesson) => lesson.approvedAt).length;
        const done = enrollment.progress.filter((progress) => progress.completedAt).length;
        const percent = total ? Math.round(done / total * 100) : 0;
        return <Link className={`card course-card ${enrollment.course.isActive ? "" : "inactive-card"}`} key={enrollment.id} href={`/learn/courses/${enrollment.courseId}`}>
          <div className="badge-row">
            <span className="badge">{enrollment.status.replaceAll("_", " ")}</span>
            {!enrollment.course.isActive && <span className="badge badge-muted">Inactive</span>}
          </div>
          <h2>{enrollment.course.title}</h2>
          <p className="muted">{enrollment.course.category} - {enrollment.course.durationMinutes} minutes</p>
          <div className="progress"><span style={{ width: `${percent}%` }} /></div>
          <p>{percent}% complete</p>
        </Link>;
      })}
      {!enrollments.length && <div className="card"><h2>No published courses</h2><p>Your assigned courses will appear here after teacher approval and publication.</p></div>}
    </div>
  </main>;
}
