import Link from "next/link";
import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

export default async function AdminDashboard() {
  await requireRole(UserRole.SUPER_ADMIN);
  const [employees, courses, enrollments, completed] = await Promise.all([
    db.employee.count({ where: { status: "ACTIVE" } }), db.course.count(), db.enrollment.count(), db.enrollment.count({ where: { status: "COMPLETED" } }),
  ]);
  return <main className="container"><h1>Administration</h1><div className="grid">
    <div className="card"><div className="stat">{employees}</div><p>Active employees</p><Link className="button secondary" href="/admin/employees">Manage employees</Link></div>
    <div className="card"><div className="stat">{courses}</div><p>Courses</p><Link className="button secondary" href="/admin/courses">Manage courses</Link></div>
    <div className="card"><div className="stat">{enrollments}</div><p>Total enrollments</p></div>
    <div className="card"><div className="stat">{completed}</div><p>Completed enrollments</p></div>
  </div><section className="card"><h2>HR testing guide</h2><p>Use the one-page checklist for employee import, teacher review, publishing and learner completion testing.</p><a className="button secondary" href="/guides/rdc-lms-hr-admin-test-guide.docx">Download HR Admin test guide</a></section></main>;
}
