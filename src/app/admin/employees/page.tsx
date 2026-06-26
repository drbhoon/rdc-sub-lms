import { UserRole } from "@prisma/client";
import { updateUserRoles } from "@/actions/employees";
import { ActionForm } from "@/components/action-form";
import { EmployeeImportForm } from "@/components/employee-import-form";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

export default async function EmployeesPage() {
  await requireRole(UserRole.SUPER_ADMIN);
  const employees = await db.employee.findMany({
    include: { company: true, user: { include: { roles: true, coursesTaught: { include: { course: true } } } } },
    orderBy: { name: "asc" },
    take: 500,
  });

  return <main className="container">
    <h1>Employees</h1>
    <div className="two-col">
      <section className="card">
        <h2>Employee master</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Company</th><th>Department</th><th>Status</th><th>Roles</th></tr></thead>
            <tbody>
              {employees.map((employee) => {
                const roles = new Set(employee.user?.roles.map((role) => role.role) ?? []);
                const taughtCount = employee.user?.coursesTaught.length ?? 0;
                return <tr key={employee.id}>
                  <td><strong>{employee.name}</strong><br /><span className="muted">{employee.employeeCode} - {employee.email}</span></td>
                  <td>{employee.company.name}{employee.locationPlant && <><br /><span className="muted">{employee.locationPlant}</span></>}</td>
                  <td>{employee.department}<br /><span className="muted">{employee.designation}</span></td>
                  <td><span className="badge">{employee.status}</span></td>
                  <td>
                    {employee.user && employee.status === "ACTIVE" ? <ActionForm action={updateUserRoles} submitLabel="Save roles">
                      <input type="hidden" name="userId" value={employee.user.id} />
                      <span className="badge">Learner</span>
                      <label className="checkbox"><input type="checkbox" name="teacher" defaultChecked={roles.has(UserRole.TEACHER)} />Teacher</label>
                      <label className="checkbox"><input type="checkbox" name="superAdmin" defaultChecked={roles.has(UserRole.SUPER_ADMIN)} />Super Admin</label>
                      {taughtCount > 0 && <p className="muted">Assigned to {taughtCount} course(s). Reassign before removing teacher role.</p>}
                    </ActionForm> : <span className="muted">Inactive</span>}
                  </td>
                </tr>;
              })}
              {!employees.length && <tr><td colSpan={5}>No employees have been imported.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="card">
        <h2>Import employees</h2>
        <p className="muted">Use the RDC template. Required: EMP_CODE, EMP_NAME, EMAIL, COMPANY and DESIGNATION. Optional: LOCATION_PLANT, DEPARTMENT, STATUS (defaults to ACTIVE), MANAGER_NAME and MOBILE_NUMBER. Re-importing an EMP_CODE updates that employee.</p>
        <p><a className="button secondary" href="/templates/rdc-employee-import-template.xlsx">Download Excel template</a></p>
        <p><a href="/templates/rdc-employee-import-template.csv">Download CSV template</a></p>
        <EmployeeImportForm />
      </aside>
    </div>
  </main>;
}
