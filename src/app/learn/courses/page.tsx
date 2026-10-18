import Link from "next/link";
import { PlayCircle } from "lucide-react";
import { UserRole } from "@prisma/client";
import { CourseTiles, type CourseTile } from "@/components/course-tiles";
import { ProgressRing } from "@/components/progress-ring";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

export default async function MyCourses() {
  const user = await requireRole(UserRole.LEARNER);
  if (!user.employeeId) {
    return <main className="container">
      <h1>My courses</h1>
      <div className="card">
        <h2>Learner profile required</h2>
        <p>This admin login has learner access, but it is not linked to an employee record yet.</p>
        <p className="muted">To test as a learner, import an active employee row using this same email address, then enrol that employee into a course.</p>
      </div>
    </main>;
  }
  const enrollments = await db.enrollment.findMany({
    where: { employeeId: user.employeeId, course: { status: "PUBLISHED" } },
    include: { course: { include: { contents: { where: { isPublished: true }, include: { lessons: true } } } }, progress: true },
    orderBy: { enrolledAt: "desc" },
  });

  const rows = enrollments.map((enrollment) => {
    const total = enrollment.course.contents.flatMap((content) => content.lessons).filter((lesson) => lesson.approvedAt).length;
    const done = enrollment.progress.filter((progress) => progress.completedAt).length;
    const percent = total ? Math.round(done / total * 100) : 0;
    const lastActive = enrollment.progress.reduce((latest, item) => Math.max(latest, item.updatedAt.getTime()), 0);
    return { enrollment, percent, lastActive };
  });
  const tiles: CourseTile[] = rows.map(({ enrollment, percent }) => ({
    id: enrollment.courseId,
    title: enrollment.course.title,
    category: enrollment.course.category,
    minutes: enrollment.course.durationMinutes,
    status: enrollment.status,
    percent,
    inactive: !enrollment.course.isActive,
  }));

  // Pick up where they left off: the unfinished course they touched most
  // recently, or, if they have not started anything, the first one waiting.
  const unfinished = rows.filter(({ enrollment }) => enrollment.status !== "COMPLETED");
  const resume = [...unfinished].sort((a, b) => b.lastActive - a.lastActive)[0] ?? null;
  const firstName = user.employee?.name.split(/\s+/)[0];

  return <main className="container home">
    <header className="home-head">
      <p className="muted">{firstName ? `Hello, ${firstName}` : "Welcome"}</p>
      <h1>My courses</h1>
    </header>

    {resume && <Link className="resume-card" href={`/learn/courses/${resume.enrollment.courseId}`}>
      <ProgressRing percent={resume.percent} size={76} stroke={8} />
      <div className="resume-text">
        <span className="resume-kicker">{resume.lastActive ? "Continue learning" : "Start learning"}</span>
        <strong>{resume.enrollment.course.title}</strong>
        <span>{resume.enrollment.course.category} · {resume.enrollment.course.durationMinutes} minutes</span>
      </div>
      <span className="resume-go"><PlayCircle size={32} aria-hidden="true" /><span className="visually-hidden">Open course</span></span>
    </Link>}

    {tiles.length
      ? <CourseTiles tiles={tiles} />
      : <div className="card"><h2>No published courses</h2><p>Your assigned courses will appear here after teacher approval and publication.</p></div>}
  </main>;
}
