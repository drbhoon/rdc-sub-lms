import Link from "next/link";
import { UserRole } from "@prisma/client";
import { AiCourseWizard } from "@/components/ai-course-wizard";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireRole } from "@/lib/session";

/** Create a course by describing it. Teachers and administrators; the result is always a draft for a teacher to review. */
export default async function AiCoursePage() {
  const user = await requireRole(UserRole.TEACHER, UserRole.SUPER_ADMIN);
  const isAdmin = user.roles.some((grant) => grant.role === UserRole.SUPER_ADMIN);
  const companies = await db.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const own = user.employee?.companyId ? [user.employee.companyId] : [];
  return <main className="container">
    <p><Link href={isAdmin ? "/admin/courses" : "/teacher/courses"}>&larr; Back to courses</Link></p>
    <header className="home-head">
      <p className="muted">Create with AI</p>
      <h1>Describe a course, get a draft</h1>
    </header>
    <section className="card">
      {env.OPENAI_API_KEY
        ? <AiCourseWizard companies={companies} defaultCompanyIds={own} reviewBase={isAdmin ? "/admin/courses" : "/teacher/courses"} />
        : <p className="message">AI is not set up on this server: the OpenAI key is missing. Ask your administrator to add it.</p>}
    </section>
  </main>;
}
