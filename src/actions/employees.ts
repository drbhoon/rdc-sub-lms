"use server";

import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import path from "node:path";
import { EmployeeStatus, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { normalizeEmail } from "@/lib/security";
import { requireRole } from "@/lib/session";

type ImportRow = Record<string, unknown>;
export type EmployeeImportState = { message?: string; preview?: boolean };
const fields = ["Employee Code", "Name", "Email", "Company", "Department", "Designation", "Status"];

export async function importEmployees(_: EmployeeImportState, formData: FormData): Promise<EmployeeImportState> {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { message: "Select a CSV or Excel file." };
  if (file.size > 10 * 1024 * 1024) return { message: "Employee files must be under 10 MB." };

  let rows: ImportRow[];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    if (path.extname(file.name).toLowerCase() === ".csv") {
      rows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as ImportRow[];
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("Workbook has no worksheets");
      const headings = (sheet.getRow(1).values as unknown[]).slice(1).map((value) => String(value ?? "").trim());
      rows = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const record: ImportRow = {};
        headings.forEach((heading, index) => { record[heading] = row.getCell(index + 1).text.trim(); });
        rows.push(record);
      });
    }
  } catch { return { message: "The employee file could not be read." }; }
  if (!rows.length) return { message: "The employee file is empty." };

  const missing = fields.filter((field) => !(field in rows[0]));
  if (missing.length) return { message: `Missing columns: ${missing.join(", ")}` };
  const errors: string[] = [];
  const normalized = rows.map((row, index) => {
    const value = (name: string) => String(row[name] ?? "").trim();
    const status = value("Status").toUpperCase();
    const record = {
      employeeCode: value("Employee Code"), name: value("Name"), email: normalizeEmail(value("Email")),
      company: value("Company"), department: value("Department"), designation: value("Designation"),
      status: status === "INACTIVE" ? EmployeeStatus.INACTIVE : EmployeeStatus.ACTIVE,
      managerName: value("Manager Name") || null, mobileNumber: value("Mobile Number") || null,
    };
    if (!record.employeeCode || !record.name || !record.email.includes("@") || !record.company || !record.department || !record.designation) errors.push(`Row ${index + 2} has invalid required values.`);
    return record;
  });
  const duplicateCodes = normalized.filter((row, index) => normalized.findIndex((candidate) => candidate.employeeCode === row.employeeCode) !== index);
  const duplicateEmails = normalized.filter((row, index) => normalized.findIndex((candidate) => candidate.email === row.email) !== index);
  if (duplicateCodes.length) errors.push("The file contains duplicate employee codes.");
  if (duplicateEmails.length) errors.push("The file contains duplicate email addresses.");
  if (errors.length) return { message: errors.slice(0, 10).join(" ") };
  const conflicts = await db.employee.findMany({ where: { email: { in: normalized.map((row) => row.email) } }, select: { email: true, employeeCode: true } });
  if (conflicts.some((existing) => normalized.some((row) => row.email === existing.email && row.employeeCode !== existing.employeeCode))) {
    return { message: "An email address in the file already belongs to a different employee code." };
  }
  if (formData.get("intent") === "preview") {
    const active = normalized.filter((row) => row.status === EmployeeStatus.ACTIVE).length;
    return { message: `${normalized.length} valid rows: ${active} active and ${normalized.length - active} inactive. Review the source file, then import.`, preview: true };
  }

  await db.$transaction(async (tx) => {
    for (const row of normalized) {
      const company = await tx.company.upsert({ where: { name: row.company }, update: {}, create: { name: row.company } });
      const employee = await tx.employee.upsert({
        where: { employeeCode: row.employeeCode },
        update: { ...row, company: undefined, companyId: company.id },
        create: { ...row, company: undefined, companyId: company.id },
      });
      const existingUser = await tx.user.findUnique({ where: { employeeId: employee.id } });
      const user = existingUser
        ? await tx.user.update({ where: { id: existingUser.id }, data: { email: row.email } })
        : await tx.user.upsert({ where: { email: row.email }, update: { employeeId: employee.id }, create: { email: row.email, employeeId: employee.id } });
      await tx.userRoleGrant.upsert({ where: { userId_role: { userId: user.id, role: UserRole.LEARNER } }, update: {}, create: { userId: user.id, role: UserRole.LEARNER } });
      if (row.status === EmployeeStatus.INACTIVE) await tx.session.deleteMany({ where: { userId: user.id } });
    }
  });
  await audit(actor.id, "EMPLOYEES_IMPORTED", "Employee", undefined, { count: normalized.length, fileName: file.name });
  revalidatePath("/admin/employees");
  return { message: `${normalized.length} employee records imported successfully.`, preview: false };
}

export async function grantTeacher(formData: FormData) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const userId = String(formData.get("userId"));
  await db.userRoleGrant.upsert({ where: { userId_role: { userId, role: UserRole.TEACHER } }, update: {}, create: { userId, role: UserRole.TEACHER } });
  await audit(actor.id, "TEACHER_ROLE_GRANTED", "User", userId);
  revalidatePath("/admin/employees");
}
