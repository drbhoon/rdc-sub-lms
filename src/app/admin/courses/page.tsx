import Link from "next/link";
import { UserRole } from "@prisma/client";
import { createCourse } from "@/actions/courses";
import { ActionForm } from "@/components/action-form";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

export default async function CoursesPage() {
  await requireRole(UserRole.SUPER_ADMIN);
  const [courses, companies, teachers] = await Promise.all([
    db.course.findMany({ include: { teachers: { include: { user: { include: { employee: true } } } }, companies: { include: { company: true } }, _count: { select: { enrollments: true, contents: true } } }, orderBy: { updatedAt: "desc" } }),
    db.company.findMany({ orderBy: { name: "asc" } }),
    db.user.findMany({ where: { roles: { some: { role: "TEACHER" } }, employee: { status: "ACTIVE" } }, include: { employee: true }, orderBy: { employee: { name: "asc" } } }),
  ]);
  return <main className="container"><h1>Courses</h1><div className="two-col"><section className="card"><h2>Course catalogue</h2><div className="grid">{courses.map((course) => <Link className="card" key={course.id} href={`/admin/courses/${course.id}`}><span className="badge">{course.status.replaceAll("_", " ")}</span><h3>{course.title}</h3><p className="muted">{course.category} · {course.durationMinutes} minutes</p><p>{course.companies.map((c) => c.company.name).join(", ")}</p><small>{course._count.contents} uploads · {course._count.enrollments} learners</small></Link>)}{!courses.length && <p>No courses created.</p>}</div></section>
  <aside className="card"><h2>Create course</h2>{!companies.length || !teachers.length ? <p>Import employees and grant at least one teacher role first.</p> : <ActionForm action={createCourse} submitLabel="Create draft course"><label>Course title<input name="title" required /></label><label>Category<input name="category" required /></label><label>Description<textarea name="description" required /></label><div className="form-row"><label>Duration (minutes)<input name="durationMinutes" type="number" min="1" defaultValue="60" /></label><label>Pass percentage<input name="passPercentage" type="number" min="1" max="100" defaultValue="70" /></label></div><label>AI token allowance<input name="aiTokenLimit" type="number" min="0" defaultValue="50000" /></label><label>Assigned teacher<select name="teacherId" required><option value="">Select</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.employee?.name}</option>)}</select></label><fieldset><legend>Applicable companies</legend>{companies.map((company) => <label className="checkbox" key={company.id}><input type="checkbox" name="companyIds" value={company.id}/>{company.name}</label>)}</fieldset><label className="checkbox"><input type="checkbox" name="certificateEnabled" defaultChecked/>Certificate enabled</label><label className="checkbox"><input type="checkbox" name="leaderboardEnabled" defaultChecked/>Leaderboard enabled</label></ActionForm>}</aside></div></main>;
}
