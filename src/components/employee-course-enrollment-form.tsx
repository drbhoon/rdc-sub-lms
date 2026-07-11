"use client";

import { useActionState, useMemo, useState } from "react";
import { enrollEmployeeInCourses } from "@/actions/courses";

type EmployeeOption = {
  id: string;
  name: string;
  employeeCode: string;
  email: string;
  companyName: string;
  companyId: string;
  isSuperAdminLearner: boolean;
  enrolledCourseIds: string[];
};

type CourseOption = {
  id: string;
  title: string;
  status: string;
  companyIds: string[];
};

export function EmployeeCourseEnrollmentForm({ employees, courses }: { employees: EmployeeOption[]; courses: CourseOption[] }) {
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [courseSearch, setCourseSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [state, formAction, pending] = useActionState<{ message?: string }, FormData>(enrollEmployeeInCourses, {});

  const filteredEmployees = useMemo(() => {
    const term = employeeSearch.trim().toLowerCase();
    if (!term) return employees.slice(0, 50);
    return employees.filter((employee) => [
      employee.name,
      employee.employeeCode,
      employee.email,
      employee.companyName,
    ].some((value) => value.toLowerCase().includes(term))).slice(0, 50);
  }, [employees, employeeSearch]);

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId);
  const eligibleCourses = useMemo(() => {
    if (!selectedEmployee) return [];
    const enrolled = new Set(selectedEmployee.enrolledCourseIds);
    const term = courseSearch.trim().toLowerCase();
    return courses.filter((course) => {
      const companyAllowed = selectedEmployee.isSuperAdminLearner || course.companyIds.includes(selectedEmployee.companyId);
      const notEnrolled = !enrolled.has(course.id);
      const matches = !term || course.title.toLowerCase().includes(term) || course.status.toLowerCase().includes(term);
      return companyAllowed && notEnrolled && matches;
    });
  }, [courses, courseSearch, selectedEmployee]);

  return <form action={formAction} className="form">
    <label>Search employee<input value={employeeSearch} onChange={(event) => setEmployeeSearch(event.currentTarget.value)} placeholder="Search by name, code, email, or company" /></label>
    <label>Employee
      <select name="employeeId" value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.currentTarget.value)} required>
        <option value="">Select employee</option>
        {filteredEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} ({employee.employeeCode}) - {employee.companyName}</option>)}
      </select>
    </label>
    {selectedEmployee && <>
      <label>Search course<input value={courseSearch} onChange={(event) => setCourseSearch(event.currentTarget.value)} placeholder="Search by course name or status" /></label>
      <div className="scroll-list">
        {eligibleCourses.map((course) => <label className="checkbox" key={course.id}>
          <input type="checkbox" name="courseIds" value={course.id} />
          <span>{course.title}<br /><small>{course.status.replaceAll("_", " ")}</small></span>
        </label>)}
        {!eligibleCourses.length && <p className="muted">No eligible unallocated courses match this employee/search.</p>}
      </div>
    </>}
    {state.message && <p className="message">{state.message}</p>}
    <button disabled={pending || !selectedEmployee}>{pending ? "Allocating..." : "Allocate selected courses"}</button>
  </form>;
}
