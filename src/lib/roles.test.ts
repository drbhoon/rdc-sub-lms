import { describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { hasAnyEffectiveRole, hasEffectiveRole } from "./roles";

const userWith = (...roles: UserRole[]) => ({ roles: roles.map((role) => ({ role })) });

describe("role inheritance", () => {
  it("treats super admins as teachers and learners", () => {
    const user = userWith(UserRole.SUPER_ADMIN);
    expect(hasEffectiveRole(user, UserRole.SUPER_ADMIN)).toBe(true);
    expect(hasEffectiveRole(user, UserRole.TEACHER)).toBe(true);
    expect(hasEffectiveRole(user, UserRole.LEARNER)).toBe(true);
  });

  it("treats super admins as admins, but admins are neither teachers nor super admins", () => {
    expect(hasEffectiveRole(userWith(UserRole.SUPER_ADMIN), UserRole.ADMIN)).toBe(true);
    const admin = userWith(UserRole.ADMIN);
    expect(hasEffectiveRole(admin, UserRole.ADMIN)).toBe(true);
    expect(hasEffectiveRole(admin, UserRole.SUPER_ADMIN)).toBe(false);
    expect(hasEffectiveRole(admin, UserRole.TEACHER)).toBe(false);
    expect(hasEffectiveRole(userWith(UserRole.TEACHER), UserRole.ADMIN)).toBe(false);
  });

  it("does not treat teachers or learners as super admins", () => {
    expect(hasEffectiveRole(userWith(UserRole.TEACHER), UserRole.SUPER_ADMIN)).toBe(false);
    expect(hasEffectiveRole(userWith(UserRole.LEARNER), UserRole.SUPER_ADMIN)).toBe(false);
  });

  it("checks any allowed role using effective roles", () => {
    expect(hasAnyEffectiveRole(userWith(UserRole.SUPER_ADMIN), [UserRole.LEARNER])).toBe(true);
    expect(hasAnyEffectiveRole(userWith(UserRole.TEACHER), [UserRole.LEARNER])).toBe(false);
  });
});
