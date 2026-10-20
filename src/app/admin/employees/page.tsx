import { Users } from "lucide-react";
import { AdminHero } from "@/components/admin-ui";
import { coverFor } from "@/lib/course-cover";
import { withBase } from "@/lib/base-path";
import { Prisma, UserRole } from "@prisma/client";
import { createEmployee, deleteEmployee, updateUserRoles, importEmployeesFromMaster } from "@/actions/employees";
import { ActionForm } from "@/components/action-form";
import { CollapsibleCard } from "@/components/collapsible-card";
import { EmployeeCourseEnrollmentForm } from "@/components/employee-course-enrollment-form";
import { EmployeeImportForm } from "@/components/employee-import-form";
import { db } from "@/lib/db";
import { formatIst } from "@/lib/ist";
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

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";

/** The Source filter: who the master has, and who it does not. */
const SOURCES = [
  { value: "", label: "All employees" },
  { value: "master", label: "In master" },
  { value: "notmaster", label: "Not in master" },
  { value: "uploaded", label: "Uploaded here" },
] as const;
type SourceFilter = (typeof SOURCES)[number]["value"];

/** A sync stamps every person it finds with one moment; "seen" means stamped in the latest run. */
const SEEN_WINDOW_MS = 10 * 60 * 1000;

function sourceWhere(filter: SourceFilter, cutoff: Date | null): Prisma.EmployeeWhereInput {
  if (filter === "uploaded") return { source: "UPLOAD" };
  if (filter === "master") return cutoff ? { masterSeenAt: { gte: cutoff } } : { id: "none" };
  if (filter === "notmaster") return cutoff ? { OR: [{ masterSeenAt: null }, { masterSeenAt: { lt: cutoff } }] } : {};
  return {};
}

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; src?: string }> }) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const { q, src } = await searchParams;
  const query = (q ?? "").trim().slice(0, 100);
  const sourceFilter: SourceFilter = SOURCES.some((item) => item.value === src) ? (src as SourceFilter) : "";
  const lastSeen = (await db.employee.aggregate({ _max: { masterSeenAt: true } }))._max.masterSeenAt;
  const seenCutoff = lastSeen ? new Date(lastSeen.getTime() - SEEN_WINDOW_MS) : null;
  const where: Prisma.EmployeeWhereInput = { AND: [employeeSearch(query), sourceWhere(sourceFilter, seenCutoff)] };
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

  // How the two databases differ, at a glance.
  const [inMasterCount, uploadedCount] = await Promise.all([
    seenCutoff ? db.employee.count({ where: { masterSeenAt: { gte: seenCutoff } } }) : 0,
    db.employee.count({ where: { source: "UPLOAD" } }),
  ]);
  const notInMasterCount = total - inMasterCount;

  // The last time LMS was brought in line with the master, by the morning job
  // or by an admin pressing Import — whichever was later.
  const lastSync = await db.auditLog.findFirst({
    where: { action: { in: ["EMPLOYEES_SYNCED_FROM_MASTER", "EMPLOYEES_IMPORTED_FROM_MASTER"] } },
    orderBy: { createdAt: "desc" },
  });
  const lastSyncDetail = (lastSync?.metadata ?? {}) as { created?: number; updated?: number; skippedNoEmail?: number; clashes?: string[]; conflicts?: number; failedChunks?: number };

  return <main className="container">
    <AdminHero icon={Users} title="Employees" subtitle="Search people, manage their roles, and bring in or enrol learners.">
      <a className="button hero-button" href={withBase("/api/employees/export")}>Download employee data Excel</a>
    </AdminHero>
    <div className="employees-layout">
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
          <select name="src" defaultValue={sourceFilter} aria-label="Show employees by source" className="source-select">
            {SOURCES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button type="submit">Search</button>
          {(query || sourceFilter) && <a className="button secondary" href={withBase("/admin/employees")}>Clear</a>}
        </form>
        <p className="muted">
          {query || sourceFilter
            ? `${matching} of ${total} employees match${query ? ` "${query}"` : ""}${sourceFilter ? ` (${SOURCES.find((item) => item.value === sourceFilter)?.label.toLowerCase()})` : ""}${matching > employees.length ? ` - showing the first ${employees.length}; narrow the search to see the rest` : ""}.`
            : `${total} employees${total > employees.length ? ` - showing the first ${employees.length} alphabetically. Search to find anyone else` : ""}.`}
        </p>
        <p className="source-summary">
          <span className="status-pill status-completed">{inMasterCount} in master</span>
          <span className="status-pill">{notInMasterCount} not in master</span>
          <span className="status-pill">{uploadedCount} uploaded here</span>
          {!lastSeen && <span className="muted"> Press “Sync Employee Data with Master” once to compare the two.</span>}
        </p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Company</th><th>Department</th><th>Status</th><th>Source</th><th>Learner view</th><th>Roles</th><th>Delete</th></tr></thead>
            <tbody>
              {employees.map((employee) => {
                const roles = new Set(employee.user?.roles.map((role) => role.role) ?? []);
                const taughtCount = employee.user?.coursesTaught.length ?? 0;
                return <tr key={employee.id}>
                  <td><div className="person"><span className="avatar" style={{ background: coverFor(employee.name) }} aria-hidden="true">{initialsOf(employee.name)}</span><div><strong>{employee.name}</strong><br /><span className="muted">{employee.employeeCode} - {employee.email}</span></div></div></td>
                  <td>{employee.company.name}{employee.locationPlant && <><br /><span className="muted">{employee.locationPlant}</span></>}</td>
                  <td>{employee.department}<br /><span className="muted">{employee.designation}</span></td>
                  <td><span className={`status-pill${employee.status === "ACTIVE" ? " status-completed" : ""}`}>{employee.status === "ACTIVE" ? "Active" : "Inactive"}</span></td>
                  <td>{seenCutoff && employee.masterSeenAt && employee.masterSeenAt >= seenCutoff
                    ? <span className="status-pill status-completed">In master</span>
                    : <span className="status-pill source-warn">{employee.source === "UPLOAD" ? "Uploaded" : "Not in master"}</span>}</td>
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
                    {actor.employeeId === employee.id ? <span className="muted">Current login cannot be deleted.</span> : <details className="row-danger"><summary>Delete…</summary><ActionForm action={deleteEmployee} submitLabel="Delete employee" buttonClassName="danger">
                      <input type="hidden" name="employeeId" value={employee.id} />
                      <label className="checkbox"><input type="checkbox" name="confirmDelete" />Confirm permanent deletion</label>
                      <span className="muted">Removes enrollments, progress, assessments, feedback and AI history.</span>
                    </ActionForm></details>}
                  </td>
                </tr>;
              })}
              {!employees.length && <tr><td colSpan={8}>{query || sourceFilter ? "No employee matches these choices." : "No employees have been imported."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <CollapsibleCard title="Sync Employee Data with Master" summary="update from ZingHR and Truein">
        <p className="muted">
          Brings LMS in line with the shared employee master, which is refreshed
          nightly from ZingHR (on roll) and Truein (off roll). New people are added,
          and for everyone already here the master&apos;s name, e-mail, company,
          designation, location, manager and mobile replace what LMS holds. Only the
          employee code is never changed. A field the master leaves blank is kept
          as it is. Roles, department, enrolments and progress are never touched.
          Anyone without an e-mail address is skipped, since sign-in here is an
          emailed code.
        </p>
        <p className="message">
          This runs only when you press the button.{" "}
          {lastSync
            ? `Last run ${formatIst(lastSync.createdAt)}: ${lastSyncDetail.created ?? 0} added, ${lastSyncDetail.updated ?? 0} updated, ${lastSyncDetail.skippedNoEmail ?? 0} skipped with no e-mail address.`
            : "It has not run yet."}
        </p>
        {Boolean(lastSyncDetail.clashes?.length) && <details className="sync-clashes">
          <summary>{lastSyncDetail.conflicts ?? lastSyncDetail.clashes!.length} people the last sync could not update</summary>
          <p className="muted">Their e-mail address belongs to a different employee code here, so nothing was changed for them. Correct or remove the older record, then sync again.</p>
          <ul>{lastSyncDetail.clashes!.map((line) => <li key={line}>{line}</li>)}</ul>
          {(lastSyncDetail.conflicts ?? 0) > lastSyncDetail.clashes!.length && <p className="muted">Showing the first {lastSyncDetail.clashes!.length}.</p>}
        </details>}
        {Boolean(lastSyncDetail.failedChunks) && <p className="message error">{lastSyncDetail.failedChunks} batches of the last sync failed. Press the button again; if it repeats, tell the developer.</p>}
        <ActionForm action={importEmployeesFromMaster} submitLabel="Sync Employee Data with Master">
          <fieldset>
            <legend>Who to import</legend>
            <label className="checkbox"><input type="checkbox" name="onroll" defaultChecked />On roll (ZingHR)</label>
            <label className="checkbox"><input type="checkbox" name="offroll" defaultChecked />Off roll / third party (Truein)</label>
            <span className="muted">Leave both ticked for everyone.</span>
          </fieldset>
        </ActionForm>
      </CollapsibleCard>

      <CollapsibleCard title="Add one employee" summary="single addition">
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
      </CollapsibleCard>

      <CollapsibleCard title="Import employees" summary="Excel upload">
        <p className="muted">Use the RDC template. Required: EMP_CODE, EMP_NAME, EMAIL, COMPANY and DESIGNATION. Optional: LOCATION_PLANT, DEPARTMENT, STATUS (defaults to ACTIVE), ROLE (Learner, Teacher, Super Admin), MANAGER_NAME and MOBILE_NUMBER. Re-importing an EMP_CODE updates that employee and grants listed roles.</p>
        <p><a className="button secondary" href={withBase("/templates/rdc-employee-import-template.xlsx")}>Download Excel template</a></p>
        <p><a href={withBase("/templates/rdc-employee-import-template.csv")}>Download CSV template</a></p>
        <EmployeeImportForm />
      </CollapsibleCard>

      <CollapsibleCard title="Allocate courses to employee" summary="enrol in courses">
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
      </CollapsibleCard>
    </div>
  </main>;
}
