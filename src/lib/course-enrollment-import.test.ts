import { describe, expect, it } from "vitest";
import { hasEmailColumn, internEmployeeCode, nameFromEmail, parseCourseEnrollmentRow } from "./course-enrollment-import";

describe("parseCourseEnrollmentRow", () => {
  it("reads a fully filled row, case- and spacing-insensitive on headers", () => {
    const row = parseCourseEnrollmentRow({ "e-mail": "Ravi@RDC.in", " Name ": "Ravi Kumar", emp_code: "A00388", Company: "RDC", Designation: "Plant Incharge" });
    expect(row).toEqual({ email: "ravi@rdc.in", name: "Ravi Kumar", employeeCode: "A00388", company: "RDC", designation: "Plant Incharge" });
  });

  it("accepts common header aliases", () => {
    // EMAILID and EMPLOYEE_NAME are not the canonical headings, but people type them anyway.
    const row = parseCourseEnrollmentRow({ EMAILID: "priya@example.com", EMPLOYEE_NAME: "Priya" });
    expect(row.email).toBe("priya@example.com");
    expect(row.name).toBe("Priya");
  });

  it("leaves everything but e-mail blank when that is all the row has", () => {
    // This is the intern case: only an address is guaranteed present.
    const row = parseCourseEnrollmentRow({ EMAIL: "intern@example.com" });
    expect(row).toEqual({ email: "intern@example.com", name: "", employeeCode: "", company: "", designation: "" });
  });
});

describe("hasEmailColumn", () => {
  it("finds the column under an alias too", () => {
    expect(hasEmailColumn({ "Email Id": "x@y.com" })).toBe(true);
  });

  it("is false when there is nothing that resolves to EMAIL", () => {
    expect(hasEmailColumn({ Name: "Ravi", Company: "RDC" })).toBe(false);
  });
});

describe("internEmployeeCode", () => {
  it("is deterministic — the same address always gets the same code", () => {
    // Load-bearing: a roster re-uploaded after a partial failure must land the
    // same person on the same code, not mint a second one.
    expect(internEmployeeCode("priya@example.com")).toBe(internEmployeeCode("priya@example.com"));
  });

  it("differs for different addresses", () => {
    expect(internEmployeeCode("priya@example.com")).not.toBe(internEmployeeCode("ravi@example.com"));
  });

  it("is readable as an intern code, not a real employee code", () => {
    expect(internEmployeeCode("priya@example.com")).toMatch(/^INTERN-[0-9A-F]{8}$/);
  });
});

describe("nameFromEmail", () => {
  it("titleises a dotted local part", () => {
    expect(nameFromEmail("priya.sharma@example.com")).toBe("Priya Sharma");
  });

  it("handles underscores and hyphens the same way", () => {
    expect(nameFromEmail("ravi_kumar@example.com")).toBe("Ravi Kumar");
    expect(nameFromEmail("anita-verma@example.com")).toBe("Anita Verma");
  });

  it("falls back to the whole address when there is nothing to split", () => {
    expect(nameFromEmail("@example.com")).toBe("@example.com");
  });
});
