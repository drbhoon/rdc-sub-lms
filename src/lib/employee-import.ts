import { EmployeeStatus } from "@prisma/client";
import { normalizeEmail } from "./security";

export type EmployeeImportRow = Record<string, unknown>;

export const employeeImportColumns = [
  "EMP_CODE", "EMP_NAME", "EMAIL", "COMPANY", "DESIGNATION",
  "LOCATION_PLANT", "DEPARTMENT", "STATUS", "MANAGER_NAME", "MOBILE_NUMBER",
] as const;

const requiredColumns = ["EMP_CODE", "EMP_NAME", "EMAIL", "COMPANY", "DESIGNATION"] as const;

const aliases: Record<string, string> = {
  EMPLOYEE_CODE: "EMP_CODE",
  NAME: "EMP_NAME",
  LOCATION: "LOCATION_PLANT",
  PLANT: "LOCATION_PLANT",
  MANAGER: "MANAGER_NAME",
  MOBILE: "MOBILE_NUMBER",
};

function canonicalHeader(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  return aliases[normalized] ?? normalized;
}

export function missingEmployeeColumns(row: EmployeeImportRow) {
  const present = new Set(Object.keys(row).map(canonicalHeader));
  return requiredColumns.filter((column) => !present.has(column));
}

export function normalizeEmployeeImportRow(row: EmployeeImportRow) {
  const values = Object.fromEntries(Object.entries(row).map(([key, value]) => [canonicalHeader(key), String(value ?? "").trim()]));
  const statusText = values.STATUS?.toUpperCase() || "ACTIVE";
  return {
    employeeCode: values.EMP_CODE ?? "",
    name: values.EMP_NAME ?? "",
    email: normalizeEmail(values.EMAIL ?? ""),
    company: values.COMPANY ?? "",
    designation: values.DESIGNATION ?? "",
    locationPlant: values.LOCATION_PLANT || null,
    department: values.DEPARTMENT || "General",
    status: statusText === "INACTIVE" ? EmployeeStatus.INACTIVE : EmployeeStatus.ACTIVE,
    statusIsValid: statusText === "ACTIVE" || statusText === "INACTIVE",
    managerName: values.MANAGER_NAME || null,
    mobileNumber: values.MOBILE_NUMBER || null,
  };
}
