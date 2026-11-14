import { UserRole } from "@prisma/client";
import { ClipboardList } from "lucide-react";
import { AdminHero } from "@/components/admin-ui";
import { EmployeeCourseEnrollmentForm } from "@/components/employee-course-enrollment-form";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

/**
 * Putting people on courses, for an Admin who does not manage the employee
 * master (that page also adds, imports, archives and grants roles, which are a
 * Super Admin's). Here an Admin searches a person and ticks courses. Putting a
 * whole list on one course is on that course's own page.
 */
export default async function AssignCoursesPage() {
  await requireRole(UserRole.ADMIN);
  const [employees, courses] = await Promise.all([
    // Same people and courses the Super Admin's own allocation card offers.
    db.employee.findMany({
      where: { status: "ACTIVE", archivedAt: null },
      select: {
        id: true, name: true, employeeCode: true, email: true, companyId: true,
        company: { select: { name: true } },
        enrollments: { select: { courseId: true } },
        user: { select: { roles: { select: { role: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    db.course.findMany({ where: { isActive: true, status: "PUBLISHED" }, include: { companies: true }, orderBy: { title: "asc" }, take: 1000 }),
  ]);

  return <main className="container">
    <AdminHero icon={ClipboardList} title="Assign courses" subtitle="Search an employee, then select the courses to enrol them in." />
    <section className="card">
      <EmployeeCourseEnrollmentForm
        employees={employees.map((employee) => ({
          id: employee.id,
          name: employee.name,
          employeeCode: employee.employeeCode,
          email: employee.email,
          companyId: employee.companyId,
          companyName: employee.company.name,
          isSuperAdminLearner: employee.user?.roles.some((grant) => grant.role === UserRole.SUPER_ADMIN) ?? false,
          enrolledCourseIds: employee.enrollments.map((enrollment) => enrollment.courseId),
        }))}
        courses={courses.map((course) => ({ id: course.id, title: course.title, status: course.status, companyIds: course.companies.map((company) => company.companyId) }))}
      />
    </section>
  </main>;
}
