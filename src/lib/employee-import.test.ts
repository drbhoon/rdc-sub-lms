import { describe, expect, it } from "vitest";
import { EmployeeStatus } from "@prisma/client";
import { missingEmployeeColumns, normalizeEmployeeImportRow } from "./employee-import";

describe("employee import", () => {
  it("accepts the RDC template and defaults optional fields", () => {
    const row = { EMP_CODE: "RDC-1", EMP_NAME: "Test User", EMAIL: " TEST@RDC.IN ", COMPANY: "RDC", DESIGNATION: "Manager" };
    expect(missingEmployeeColumns(row)).toEqual([]);
    expect(normalizeEmployeeImportRow(row)).toMatchObject({
      employeeCode: "RDC-1", name: "Test User", email: "test@rdc.in", department: "General", status: EmployeeStatus.ACTIVE,
    });
  });

  it("continues to accept the legacy headings", () => {
    const row = { "Employee Code": "RDC-2", Name: "Legacy User", Email: "legacy@rdc.in", Company: "RDC", Designation: "Engineer", "Location/Plant": "Plant 1" };
    expect(missingEmployeeColumns(row)).toEqual([]);
    expect(normalizeEmployeeImportRow(row).locationPlant).toBe("Plant 1");
  });
});
