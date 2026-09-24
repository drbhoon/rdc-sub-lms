import { withBase } from "@/lib/base-path";
import { Prisma, UserRole } from "@prisma/client";
import { createEmployee, deleteEmployee, updateUserRoles, importEmployeesFromMaster } from "@/actions/employees";
import { ActionForm } from "@/components/action-form";
import { EmployeeCourseEnrollmentForm } from "@/components/employee-course-enrollment-form";
import { EmployeeImportForm } from "@/components/employee-import-form";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

/** How many rows the master table draws at once. The employee master holds
 *  well over this, so the page says when it is showing only part of it. */
const PAGE_LIMIT = 1000;

/**
 * Search runs in the database, not the browser: the table only ever holds the
 * first PAGE_LIMIT rows, so filtering what was already loaded could never find
 * the employees beyond them — which, with ~1,370 people on the master, is a
 * quarter of the company.
 */
function employeeSearch(query: string): Prisma.EmployeeWhereInput {
  if (!query) return {};
  const like = { contains: query, mode: Prisma.QueryMode.insensitive };
  return {
    OR: [
      { name: like },
      { employeeCode: like },
      { email: like },
      { department: like },
      { designation: like },
      { locationPlant: like },
      { company: { name: like } },
    ],
  };
}

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const { q } = await searchParams;
  const query = (q ?? "").trim().slice(0, 100);
  const where = employeeSearch(query);
  const [employees, matching, total, allocatable, activeCourses, companies] = await Promise.all([
    db.employee.findMany({
      where,
      include: { company: true, enrollments: { select: { courseId: true } }, user: { include: { roles: true, coursesTaught: { include: { course: true } } } } },
      orderBy: { name: "asc" },
      take: PAGE_LIMIT,
    }),
    db.employee.count({ where }),
    db.employee.count(),
    // The course-allocation picker has its own search box and must be able to
    // reach every active employee, whatever the master table is filtered to.
    // It used to reuse the table's rows, so it silently stopped at 1,000 too.
    db.employee.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true, name: true, employeeCode: true, email: true, companyId: true,
        company: { select: { name: true } },
        enrollments: { select: { courseId: true } },
        user: { select: { roles: { select: { role: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    db.course.findMany({
      where: { isActive: true, status: "PUBLISHED" },
      include: { companies: true },
      orderBy: { title: "asc" },
      take: 1000,
    }),
    db.company.findMany({ orderBy: { name: "asc" } }),
  ]);

  return <main className="container">
    <h1>Employees</h1>
    <p><a className="button secondary" href={withBase("/api/employees/export")}>Download employee data Excel</a></p>
    <div className="two-col">
      <section className="card">
        <h2>Employee master</h2>
        <form className="employee-search" method="get" role="search">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search by name, employee code, e-mail, company, plant, department or designation"
            aria-label="Search employees"
            maxLength={100}
          />
          <button type="submit">Search</button>
          {query && <a className="button secondary" href={withBase("/admin/employees")}>Clear</a>}
        </form>
        <p className="muted">
          {query
            ? `${matching} of ${total} employees match "${query}"${matching > employees.length ? ` - showing the first ${employees.length}; narrow the search to see the rest` : ""}.`
            : `${total} employees${total > employees.length ? ` - showing the first ${employees.length} alphabetically. Search to find anyone else` : ""}.`}
        </p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Company</th><th>Department</th><th>Status</th><th>Learner view</th><th>Roles</th><th>Delete</th></tr></thead>
            <tbody>
              {employees.map((employee) => {
                const roles = new Set(employee.user?.roles.map((role) => role.role) ?? []);
                const taughtCount = employee.user?.coursesTaught.length ?? 0;
                return <tr key={employee.id}>
                  <td><strong>{employee.name}</strong><br /><span className="muted">{employee.employeeCode} - {employee.email}</span></td>
                  <td>{employee.company.name}{employee.locationPlant && <><br /><span className="muted">{employee.locationPlant}</span></>}</td>
                  <td>{employee.department}<br /><span className="muted">{employee.designation}</span></td>
                  <td><span className="badge">{employee.status}</span></td>
                  <td><a className="button secondary" href={withBase(`/admin/learners/${employee.id}`)}>View activity</a></td>
                  <td>
                    {employee.user && employee.status === "ACTIVE" ? <ActionForm action={updateUserRoles} submitLabel="Save roles">
                      <input type="hidden" name="userId" value={employee.user.id} />
                      <span className="badge">Learner</span>
                      <label className="checkbox"><input type="checkbox" name="teacher" defaultChecked={roles.has(UserRole.TEACHER)} />Teacher</label>
                      <label className="checkbox"><input type="checkbox" name="superAdmin" defaultChecked={roles.has(UserRole.SUPER_ADMIN)} />Super Admin</label>
                      {taughtCount > 0 && <p className="muted">Assigned to {taughtCount} course(s). Reassign before removing teacher role.</p>}
                    </ActionForm> : <span className="muted">Inactive</span>}
                  </td>
                  <td>
                    {actor.employeeId === employee.id ? <span className="muted">Current login cannot be deleted.</span> : <ActionForm action={deleteEmployee} submitLabel="Delete employee" buttonClassName="danger">
                      <input type="hidden" name="employeeId" value={employee.id} />
                      <label className="checkbox"><input type="checkbox" name="confirmDelete" />Confirm permanent deletion</label>
                      <span className="muted">Removes enrollments, progress, assessments, feedback and AI history.</span>
                    </ActionForm>}
                  </td>
                </tr>;
              })}
              {!employees.length && <tr><td colSpan={7}>{query ? `No employee matches "${query}".` : "No employees have been imported."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="card">
        <h2>Import from Employee Master</h2>
        <p className="muted">
          Pulls learners from the shared employee master, refreshed nightly from
          ZingHR (on roll) and Truein (off roll). Existing learners are updated in
          place — roles, enrolments and progress are never touched. Anyone without
          an e-mail address is skipped, since sign-in here is an emailed code.
        </p>
        <ActionForm action={importEmployeesFromMaster} submitLabel="Import from master">
          <fieldset>
            <legend>Who to import</legend>
            <label className="checkbox"><input type="checkbox" name="onroll" defaultChecked />On roll (ZingHR)</label>
            <label className="checkbox"><input type="checkbox" name="offroll" defaultChecked />Off roll / third party (Truein)</label>
            <span className="muted">Leave both ticked for everyone.</span>
          </fieldset>
        </ActionForm>
      </aside>

      <aside className="card">
        <h2>Add one employee</h2>
        <p className="muted">Use this form for individual additions. Excel upload remains available for bulk changes.</p>
        {!companies.length ? <p>Create a company through the employee import first.</p> : <ActionForm action={createEmployee} submitLabel="Add employee">
          <div className="form-row">
            <label>Employee code<input name="employeeCode" required maxLength={50} /></label>
            <label>Employee name<input name="name" required maxLength={150} /></label>
          </div>
          <label>Email<input name="email" type="email" required maxLength={254} /></label>
          <label>Company<select name="companyId" required defaultValue=""><option value="" disabled>Select company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
          <div className="form-row">
            <label>Designation<input name="designation" required maxLength={120} /></label>
            <label>Department<input name="department" maxLength={120} placeholder="General" /></label>
          </div>
          <div className="form-row">
            <label>Location/Plant<input name="locationPlant" maxLength={120} /></label>
            <label>Manager name<input name="managerName" maxLength={150} /></label>
          </div>
          <label>Mobile number<input name="mobileNumber" maxLength={30} /></label>
          <fieldset><legend>Roles</legend>
            <span className="badge">Learner</span>
            <label className="checkbox"><input type="checkbox" name="teacher" />Teacher</label>
            <label className="checkbox"><input type="checkbox" name="superAdmin" />Super Admin</label>
          </fieldset>
        </ActionForm>}
      </aside>

      <aside className="card">
        <h2>Import employees</h2>
        <p className="muted">Use the RDC template. Required: EMP_CODE, EMP_NAME, EMAIL, COMPANY and DESIGNATION. Optional: LOCATION_PLANT, DEPARTMENT, STATUS (defaults to ACTIVE), ROLE (Learner, Teacher, Super Admin), MANAGER_NAME and MOBILE_NUMBER. Re-importing an EMP_CODE updates that employee and grants listed roles.</p>
        <p><a className="button secondary" href={withBase("/templates/rdc-employee-import-template.xlsx")}>Download Excel template</a></p>
        <p><a href={withBase("/templates/rdc-employee-import-template.csv")}>Download CSV template</a></p>
        <EmployeeImportForm />
      </aside>

      <aside className="card">
        <h2>Allocate courses to employee</h2>
        <p className="muted">Search an employee, then select one or more eligible courses.</p>
        <EmployeeCourseEnrollmentForm
          employees={allocatable.map((employee) => {
            const roles = employee.user?.roles.map((role) => role.role) ?? [];
            return {
              id: employee.id,
              name: employee.name,
              employeeCode: employee.employeeCode,
              email: employee.email,
              companyId: employee.companyId,
              companyName: employee.company.name,
              isSuperAdminLearner: roles.includes(UserRole.SUPER_ADMIN),
              enrolledCourseIds: employee.enrollments.map((enrollment) => enrollment.courseId),
            };
          })}
          courses={activeCourses.map((course) => ({
            id: course.id,
            title: course.title,
            status: course.status,
            companyIds: course.companies.map((company) => company.companyId),
          }))}
        />
      </aside>
    </div>
  </main>;
}
