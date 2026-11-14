import { describe, expect, it } from "vitest";
import { EmployeeStatus, UserRole } from "@prisma/client";
import { missingEmployeeColumns, normalizeEmployeeImportRow } from "./employee-import";

describe("employee import", () => {
  it("accepts the RDC template and defaults optional fields", () => {
    const row = { EMP_CODE: "RDC-1", EMP_NAME: "Test User", EMAIL: " TEST@RDC.IN ", COMPANY: "RDC", DESIGNATION: "Manager" };
    expect(missingEmployeeColumns(row)).toEqual([]);
    expect(normalizeEmployeeImportRow(row)).toMatchObject({
      employeeCode: "RDC-1", name: "Test User", email: "test@rdc.in", department: "General", status: EmployeeStatus.ACTIVE,
      roles: [UserRole.LEARNER],
    });
  });

  it("continues to accept the legacy headings", () => {
    const row = { "Employee Code": "RDC-2", Name: "Legacy User", Email: "legacy@rdc.in", Company: "RDC", Designation: "Engineer", "Location/Plant": "Plant 1" };
    expect(missingEmployeeColumns(row)).toEqual([]);
    expect(normalizeEmployeeImportRow(row).locationPlant).toBe("Plant 1");
  });

  it("parses optional role grants", () => {
    const row = { EMP_CODE: "RDC-3", EMP_NAME: "Teacher User", EMAIL: "teacher@rdc.in", COMPANY: "RDC", DESIGNATION: "Engineer", ROLE: "Learner; Teacher" };
    expect(normalizeEmployeeImportRow(row)).toMatchObject({ roleIsValid: true, roles: [UserRole.LEARNER, UserRole.TEACHER] });
  });

  it("gives the Admin role for ADMIN, and only the Admin role", () => {
    const row = { EMP_CODE: "RDC-4", EMP_NAME: "Admin User", EMAIL: "admin@rdc.in", COMPANY: "RDC", DESIGNATION: "Admin", ROLE: "Admin" };
    expect(normalizeEmployeeImportRow(row).roles).toEqual([UserRole.LEARNER, UserRole.ADMIN]);
  });

  it("gives Super Admin (with Admin and Teacher) only when it is asked for by name", () => {
    const row = { EMP_CODE: "RDC-5", EMP_NAME: "Super User", EMAIL: "super@rdc.in", COMPANY: "RDC", DESIGNATION: "Head", ROLE: "Super Admin" };
    expect(normalizeEmployeeImportRow(row).roles).toEqual([UserRole.LEARNER, UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.TEACHER]);
  });
});
