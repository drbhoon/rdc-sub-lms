import { UserRole } from "@prisma/client";

/** Teaching a course: approving and publishing its content, answering its learners. */
export function canManageCourse(roles: UserRole[], isAssignedTeacher: boolean) {
  return roles.includes(UserRole.SUPER_ADMIN) || isAssignedTeacher;
}

/** Setting a course up: its content, sessions, reels, quizzes, classrooms, and reading its results. An Admin may, without teaching it. */
export function canBuildCourse(roles: UserRole[], isAssignedTeacher: boolean) {
  return canManageCourse(roles, isAssignedTeacher) || roles.includes(UserRole.ADMIN);
}
