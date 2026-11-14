import { describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { canBuildCourse, canManageCourse } from "./course-access-policy";

describe("canManageCourse", () => {
  it("allows super administrators", () => {
    expect(canManageCourse([UserRole.SUPER_ADMIN], false)).toBe(true);
  });

  it("allows the assigned teacher", () => {
    expect(canManageCourse([UserRole.TEACHER], true)).toBe(true);
  });

  it("rejects learners and unassigned teachers", () => {
    expect(canManageCourse([UserRole.LEARNER], false)).toBe(false);
    expect(canManageCourse([UserRole.TEACHER], false)).toBe(false);
  });
});

describe("an Admin and a course", () => {
  it("may set any course up, but may not teach it (approve, publish, answer)", () => {
    expect(canBuildCourse([UserRole.ADMIN], false)).toBe(true);
    expect(canManageCourse([UserRole.ADMIN], false)).toBe(false);
  });

  it("is not given more by being a learner, and an unassigned teacher still cannot build", () => {
    expect(canBuildCourse([UserRole.LEARNER], false)).toBe(false);
    expect(canBuildCourse([UserRole.TEACHER], false)).toBe(false);
    expect(canBuildCourse([UserRole.TEACHER], true)).toBe(true);
    expect(canBuildCourse([UserRole.SUPER_ADMIN], false)).toBe(true);
  });
});
