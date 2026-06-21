import { UserRole } from "@prisma/client";
import { grantTeacher } from "@/actions/employees";
import { EmployeeImportForm } from "@/components/employee-import-form";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

export default async function EmployeesPage() {
  await requireRole(UserRole.SUPER_ADMIN);
  const employees = await db.employee.findMany({ include: { company: true, user: { include: { roles: true } } }, orderBy: { name: "asc" }, take: 500 });
  return <main className="container"><h1>Employees</h1><div className="two-col"><section className="card"><h2>Employee master</h2><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Company</th><th>Department</th><th>Status</th><th>Role</th></tr></thead><tbody>
    {employees.map((employee) => { const teacher = employee.user?.roles.some((r) => r.role === "TEACHER"); return <tr key={employee.id}><td><strong>{employee.name}</strong><br/><span className="muted">{employee.employeeCode} · {employee.email}</span></td><td>{employee.company.name}</td><td>{employee.department}<br/><span className="muted">{employee.designation}</span></td><td><span className="badge">{employee.status}</span></td><td>{teacher ? <span className="badge">Teacher</span> : employee.user && employee.status === "ACTIVE" ? <form action={grantTeacher}><input type="hidden" name="userId" value={employee.user.id}/><button className="secondary">Make teacher</button></form> : "—"}</td></tr>; })}
    {!employees.length && <tr><td colSpan={5}>No employees have been imported.</td></tr>}
  </tbody></table></div></section><aside className="card"><h2>Import employees</h2><p className="muted">Upload CSV or Excel with the required specification columns. Existing employee codes are updated.</p><EmployeeImportForm /></aside></div></main>;
}
