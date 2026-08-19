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
  // Selection lives in React, not in the checkboxes.
  //
  // Every active employee is eligible now, so this list is ~1536 rows and only
  // a window of it is rendered. A checkbox that scrolls or filters out of that
  // window is UNMOUNTED, and an unmounted input is not submitted — so ticking
  // someone and then searching for the next person would silently drop the
  // first. Holding the ids here means a batch can be built across as many
  // searches as it takes, which is how an admin actually enrols a group.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
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

  // Render a window, not the whole list: painting 1500 rows makes the page
  // crawl and helps nobody, since the way to find one person is to type a name.
  const shown = useMemo(() => filtered.slice(0, 100), [filtered]);

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return <form action={formAction} className="form">
    <input type="hidden" name="courseId" value={courseId} />
    {/* The real payload. Rendered for every selected id, whether or not its row
        is currently on screen. */}
    {[...selected].map((id) => <input key={id} type="hidden" name="employeeIds" value={id} />)}

    <label>Search employee<input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search by name, code, email, or company" /></label>

    <p className="muted">
      {query.trim()
        ? `${filtered.length} of ${employees.length} match "${query.trim()}"`
        : `${employees.length} employees can be enrolled. Type a name, code or email to narrow the list.`}
      {shown.length < filtered.length && ` Showing the first ${shown.length} — keep typing to reach the rest.`}
    </p>

    {selected.size > 0 && <p className="message">
      {selected.size} selected{" "}
      <button type="button" onClick={() => setSelected(new Set())}>Clear selection</button>
    </p>}

    <div className="scroll-list">
      {shown.map((employee) => <label className="checkbox" key={employee.id}>
        <input
          type="checkbox"
          checked={selected.has(employee.id)}
          onChange={() => toggle(employee.id)}
        />
        <span>{employee.name} ({employee.employeeCode})<br /><small>{employee.companyName} · {employee.email}</small></span>
        {employee.isAdminLearner && <span className="badge">Admin test learner</span>}
      </label>)}
      {!filtered.length && <p className="muted">No employee matches this search.</p>}
    </div>

    {state.message && <p className="message">{state.message}</p>}
    {/* Gated on the SELECTION, not on what happens to be listed: with a batch
        already picked, a search that matches nobody must not disable the
        button and strand it. */}
    <button disabled={pending || selected.size === 0}>
      {pending ? "Enrolling..." : `Enroll ${selected.size || ""} selected`.replace("  ", " ")}
    </button>
  </form>;
}
