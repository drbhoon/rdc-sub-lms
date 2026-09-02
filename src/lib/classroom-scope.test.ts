import { UserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { classroomScope, enrollmentScopeWhere } from "./classroom-scope";

describe("classroomScope", () => {
  it("does not scope a super admin, even when they run a classroom", () => {
    const scope = classroomScope({ roles: [UserRole.SUPER_ADMIN], ownedClassroomIds: ["c1"] });
    expect(scope.scoped).toBe(false);
    expect(enrollmentScopeWhere(scope)).toEqual({});
  });

  it("scopes a teacher to the classrooms they run", () => {
    const scope = classroomScope({ roles: [UserRole.TEACHER], ownedClassroomIds: ["c1", "c2"] });
    expect(scope.scoped).toBe(true);
    expect(enrollmentScopeWhere(scope)).toEqual({ classroomId: { in: ["c1", "c2"] } });
  });

  // The regression this rule exists to prevent: every enrolment predating
  // classrooms has none, so scoping a teacher who runs no classroom would show
  // them an empty course they could previously manage in full.
  it("does not scope a teacher who runs no classroom on this course", () => {
    const scope = classroomScope({ roles: [UserRole.TEACHER], ownedClassroomIds: [] });
    expect(scope.scoped).toBe(false);
    expect(enrollmentScopeWhere(scope)).toEqual({});
  });
});
