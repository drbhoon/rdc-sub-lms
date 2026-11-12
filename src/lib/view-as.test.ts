import { describe, expect, it } from "vitest";
import { VIEW_AS_MINUTES, createViewAsValue, isWriteOperation, readViewAsValue } from "./view-as";

describe("view-as cookie", () => {
  const now = Date.UTC(2026, 10, 12, 6, 0, 0);

  it("names the employee for the administrator whose session signed it", () => {
    const value = createViewAsValue("session-token", "admin-1", "emp-9", now);
    expect(readViewAsValue(value, "session-token", "admin-1", now + 1000)).toBe("emp-9");
  });

  it("is refused after it expires", () => {
    const value = createViewAsValue("session-token", "admin-1", "emp-9", now);
    expect(readViewAsValue(value, "session-token", "admin-1", now + VIEW_AS_MINUTES * 60_000 + 1)).toBeNull();
  });

  it("is refused for another session or another administrator", () => {
    const value = createViewAsValue("session-token", "admin-1", "emp-9", now);
    expect(readViewAsValue(value, "other-token", "admin-1", now)).toBeNull();
    expect(readViewAsValue(value, "session-token", "admin-2", now)).toBeNull();
  });

  it("is refused when the employee or the expiry is changed", () => {
    const value = createViewAsValue("session-token", "admin-1", "emp-9", now);
    const [, expires, signature] = value.split(".");
    expect(readViewAsValue(`emp-10.${expires}.${signature}`, "session-token", "admin-1", now)).toBeNull();
    expect(readViewAsValue(`emp-9.${Number(expires) + 600000}.${signature}`, "session-token", "admin-1", now)).toBeNull();
  });

  it("is refused when empty or malformed", () => {
    expect(readViewAsValue(undefined, "t", "a", now)).toBeNull();
    expect(readViewAsValue("", "t", "a", now)).toBeNull();
    expect(readViewAsValue("a.b", "t", "a", now)).toBeNull();
    expect(readViewAsValue("a.notanumber.sig", "t", "a", now)).toBeNull();
  });
});

describe("isWriteOperation", () => {
  it("flags every operation that changes data and none that only read", () => {
    for (const operation of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]) expect(isWriteOperation(operation)).toBe(true);
    for (const operation of ["findUnique", "findFirst", "findMany", "count", "aggregate", "groupBy", "findUniqueOrThrow"]) expect(isWriteOperation(operation)).toBe(false);
  });
});
