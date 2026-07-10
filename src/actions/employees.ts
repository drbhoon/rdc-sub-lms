"use server";

import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import path from "node:path";
import { EmployeeStatus, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { missingEmployeeColumns, normalizeEmployeeImportRow } from "@/lib/employee-import";
import { requireRole } from "@/lib/session";

type ImportRow = Record<string, unknown>;
export type EmployeeImportState = { message?: string; preview?: boolean };

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
  rows = rows.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
  if (!rows.length) return { message: "The employee file is empty." };

  const missing = missingEmployeeColumns(rows[0]);
  if (missing.length) return { message: `Missing columns: ${missing.join(", ")}` };
  const errors: string[] = [];
  const normalized = rows.map((row, index) => {
    const record = normalizeEmployeeImportRow(row);
    if (!record.employeeCode || !record.name || !record.email.includes("@") || !record.company || !record.designation || !record.statusIsValid || !record.roleIsValid) errors.push(`Row ${index + 2} has invalid required values, status, or role.`);
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
      const employeeData = {
        employeeCode: row.employeeCode,
        name: row.name,
        email: row.email,
        department: row.department,
        designation: row.designation,
        locationPlant: row.locationPlant,
        status: row.status,
        managerName: row.managerName,
        mobileNumber: row.mobileNumber,
      };
      const employee = await tx.employee.upsert({
        where: { employeeCode: row.employeeCode },
        update: { ...employeeData, companyId: company.id },
        create: { ...employeeData, companyId: company.id },
      });
      const existingUser = await tx.user.findUnique({ where: { employeeId: employee.id } });
      const user = existingUser
        ? await tx.user.update({ where: { id: existingUser.id }, data: { email: row.email } })
        : await tx.user.upsert({ where: { email: row.email }, update: { employeeId: employee.id }, create: { email: row.email, employeeId: employee.id } });
      for (const role of row.roles) {
        await tx.userRoleGrant.upsert({ where: { userId_role: { userId: user.id, role } }, update: {}, create: { userId: user.id, role } });
      }
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

export async function updateUserRoles(_: { message?: string }, formData: FormData) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const userId = String(formData.get("userId") ?? "");
  const makeSuperAdmin = formData.get("superAdmin") === "on";
  const makeTeacher = formData.get("teacher") === "on" || makeSuperAdmin;
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { employee: true, roles: true, coursesTaught: { include: { course: true } } },
  });
  if (!user || user.employee?.status !== EmployeeStatus.ACTIVE) return { message: "Only active employees can have roles changed." };

  const currentlySuperAdmin = user.roles.some((role) => role.role === UserRole.SUPER_ADMIN);
  if (actor.id === userId && currentlySuperAdmin && !makeSuperAdmin) return { message: "You cannot remove your own Super Admin role." };
  if (currentlySuperAdmin && !makeSuperAdmin) {
    const superAdminCount = await db.userRoleGrant.count({ where: { role: UserRole.SUPER_ADMIN } });
    if (superAdminCount <= 1) return { message: "At least one Super Admin must remain." };
  }
  if (!makeTeacher && user.coursesTaught.length) {
    const courseNames = user.coursesTaught.slice(0, 3).map((assignment) => assignment.course.title).join(", ");
    return { message: `Reassign this teacher from ${user.coursesTaught.length} course(s) first: ${courseNames}${user.coursesTaught.length > 3 ? ", ..." : ""}` };
  }

  await db.$transaction(async (tx) => {
    await tx.userRoleGrant.upsert({ where: { userId_role: { userId, role: UserRole.LEARNER } }, update: {}, create: { userId, role: UserRole.LEARNER } });
    if (makeTeacher) await tx.userRoleGrant.upsert({ where: { userId_role: { userId, role: UserRole.TEACHER } }, update: {}, create: { userId, role: UserRole.TEACHER } });
    else await tx.userRoleGrant.deleteMany({ where: { userId, role: UserRole.TEACHER } });
    if (makeSuperAdmin) await tx.userRoleGrant.upsert({ where: { userId_role: { userId, role: UserRole.SUPER_ADMIN } }, update: {}, create: { userId, role: UserRole.SUPER_ADMIN } });
    else await tx.userRoleGrant.deleteMany({ where: { userId, role: UserRole.SUPER_ADMIN } });
  });

  await audit(actor.id, "USER_ROLES_UPDATED", "User", userId, { teacher: makeTeacher, superAdmin: makeSuperAdmin });
  revalidatePath("/admin/employees");
  revalidatePath("/admin/courses");
  revalidatePath("/teacher/courses");
  return { message: "Roles updated." };
}
