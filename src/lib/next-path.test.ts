import { describe, expect, it } from "vitest";
import { loginUrl, safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it("accepts an ordinary page path, such as a course invite link", () => {
    expect(safeNextPath("/learn/courses/cmsn5huqg0044pf3hk4qpie0j")).toBe("/learn/courses/cmsn5huqg0044pf3hk4qpie0j");
    expect(safeNextPath("/teacher/courses/abc-123")).toBe("/teacher/courses/abc-123");
  });

  it("refuses anything that could leave the site", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "evil.example/learn", "javascript:alert(1)", "/%0d%0aSet-Cookie:x", "/a b", "/a?b=c", "/a#b"]) {
      expect(safeNextPath(bad)).toBeNull();
    }
  });

  it("refuses blanks and paths that would loop or add nothing", () => {
    for (const none of [null, undefined, "", "   ", "/", "/login", "/login/x", "/dashboard"]) expect(safeNextPath(none)).toBeNull();
  });
});

describe("loginUrl", () => {
  it("remembers where the visitor was going", () => {
    expect(loginUrl("/learn/courses/abc")).toBe("/login?next=%2Flearn%2Fcourses%2Fabc");
  });

  it("is just the login when there is nothing safe to remember", () => {
    expect(loginUrl(null)).toBe("/login");
    expect(loginUrl("https://evil.example")).toBe("/login");
    expect(loginUrl("/login")).toBe("/login");
  });
});
