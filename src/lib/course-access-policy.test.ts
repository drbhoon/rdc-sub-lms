import { describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { canManageCourse } from "./course-access-policy";

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
