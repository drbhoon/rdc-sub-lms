"use client";

import { useActionState, useMemo, useState } from "react";
import { enrollEmployeesFromPicker } from "@/actions/courses";

type EmployeeOption = {
  id: string;
  name: string;
  employeeCode: string;
  email: string;
  companyName: string;
  isAdminLearner: boolean;
};

export function CourseEnrollmentPicker({ courseId, employees }: { courseId: string; employees: EmployeeOption[] }) {
  const [query, setQuery] = useState("");
  const [state, formAction, pending] = useActionState<{ message?: string }, FormData>(enrollEmployeesFromPicker, {});
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((employee) => [
      employee.name,
      employee.employeeCode,
      employee.email,
      employee.companyName,
    ].some((value) => value.toLowerCase().includes(term)));
  }, [employees, query]);

  return <form action={formAction} className="form">
    <input type="hidden" name="courseId" value={courseId} />
    <label>Search employee<input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search by name, code, email, or company" /></label>
    <div className="scroll-list">
      {filtered.map((employee) => <label className="checkbox" key={employee.id}>
        <input type="checkbox" name="employeeIds" value={employee.id} />
        <span>{employee.name} ({employee.employeeCode})<br /><small>{employee.companyName} · {employee.email}</small></span>
        {employee.isAdminLearner && <span className="badge">Admin test learner</span>}
      </label>)}
      {!filtered.length && <p className="muted">No eligible employee matches this search.</p>}
    </div>
    {state.message && <p className="message">{state.message}</p>}
    <button disabled={pending || !filtered.length}>{pending ? "Enrolling..." : "Enroll selected"}</button>
  </form>;
}
