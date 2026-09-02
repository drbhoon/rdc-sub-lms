import { UserRole } from "@prisma/client";

/**
 * Which classrooms' learners a viewer may see on a course.
 *
 * The rule, and why it is not simply "teachers see their own classroom":
 *
 *  - A SUPER_ADMIN sees everyone. Nothing new.
 *  - A teacher who runs one or more classrooms on this course sees THOSE
 *    learners only. That is the point of the feature.
 *  - A teacher who runs NO classroom here still sees everyone.
 *
 * That last case matters. Every enrolment made before classrooms existed has no
 * classroom, and courses may never gain one. Scoping on "has a classroom
 * anywhere" would have emptied those teachers' pages overnight, which is a
 * regression dressed up as a feature. Classrooms constrain a teacher only once
 * that teacher actually has one.
 */
export function classroomScope(input: { roles: UserRole[]; ownedClassroomIds: string[] }) {
  if (input.roles.includes(UserRole.SUPER_ADMIN)) return { scoped: false, classroomIds: [] as string[] };
  if (input.ownedClassroomIds.length === 0) return { scoped: false, classroomIds: [] as string[] };
  return { scoped: true, classroomIds: input.ownedClassroomIds };
}

/** Prisma `where` fragment for Enrollment, given the scope above. */
export function enrollmentScopeWhere(scope: { scoped: boolean; classroomIds: string[] }) {
  return scope.scoped ? { classroomId: { in: scope.classroomIds } } : {};
}
