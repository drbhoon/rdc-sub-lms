/**
 * Who teaches a learner, for the results table and its Excel: the teacher of
 * the classroom the learner sits in.
 *
 * A teacher is a User, and usually an employee too, so name and employee code
 * come from the employee record. A teacher with no employee record (a Super
 * Admin who is not on the master) falls back to their e-mail and has no code.
 * A learner in no classroom, or in one with no teacher yet, has neither.
 */
type ClassroomTeacher = {
  email: string;
  employee: { name: string; employeeCode: string } | null;
} | null | undefined;

export function classroomTeacher(teacher: ClassroomTeacher): { name: string; code: string } {
  if (!teacher) return { name: "", code: "" };
  return { name: teacher.employee?.name ?? teacher.email, code: teacher.employee?.employeeCode ?? "" };
}
