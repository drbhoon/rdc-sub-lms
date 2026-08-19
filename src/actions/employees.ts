"use server";

import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import path from "node:path";
import { EmployeeStatus, Prisma, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { missingEmployeeColumns, normalizeEmployeeImportRow } from "@/lib/employee-import";
import { resolvePersonId } from "@/lib/identity";
import { fetchMasterEmployees, masterConfigured, type MasterSource } from "@/lib/master";
import { groupDuplicateCompanies, normaliseCompany, pickSurvivingCompany } from "@/lib/company-merge";
import { requireRole } from "@/lib/session";

type ImportRow = Record<string, unknown>;
export type EmployeeImportState = { message?: string; preview?: boolean };

const employeeSchema = z.object({
  employeeCode: z.string().trim().min(1, "Employee code is required.").max(50),
  name: z.string().trim().min(2, "Employee name is required.").max(150),
  email: z.string().trim().email("Enter a valid email address.").max(254),
  companyId: z.string().min(1, "Select a company."),
  department: z.string().trim().max(120).optional(),
  designation: z.string().trim().min(2, "Designation is required.").max(120),
  locationPlant: z.string().trim().max(120).optional(),
  managerName: z.string().trim().max(150).optional(),
  mobileNumber: z.string().trim().max(30).optional(),
});

export async function createEmployee(_: { message?: string }, formData: FormData) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const parsed = employeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { message: parsed.error.issues[0].message };
  const input = parsed.data;
  const email = input.email.toLowerCase();
  const makeSuperAdmin = formData.get("superAdmin") === "on";
  const makeTeacher = formData.get("teacher") === "on" || makeSuperAdmin;
  const company = await db.company.findUnique({ where: { id: input.companyId }, select: { id: true } });
  if (!company) return { message: "Selected company was not found." };

  // Resolved OUTSIDE the transaction: it is a network call to another
  // container, and holding a database transaction open across one is how a
  // slow neighbour turns into lock contention here. A null result is fine.
  const personId = await resolvePersonId(email, input.name, input.employeeCode);

  try {
    const employee = await db.$transaction(async (tx) => {
      const created = await tx.employee.create({
        data: {
          employeeCode: input.employeeCode,
          name: input.name,
          email,
          personId,
          companyId: company.id,
          department: input.department || "General",
          designation: input.designation,
          locationPlant: input.locationPlant || null,
          managerName: input.managerName || null,
          mobileNumber: input.mobileNumber || null,
          status: EmployeeStatus.ACTIVE,
        },
      });
      const existingUser = await tx.user.findUnique({ where: { email } });
      if (existingUser?.employeeId) throw new Error("This email is already linked to another employee.");
      const user = existingUser
        ? await tx.user.update({ where: { id: existingUser.id }, data: { employeeId: created.id } })
        : await tx.user.create({ data: { email, employeeId: created.id } });
      const roles = [UserRole.LEARNER, ...(makeTeacher ? [UserRole.TEACHER] : []), ...(makeSuperAdmin ? [UserRole.SUPER_ADMIN] : [])];
      await tx.userRoleGrant.createMany({ data: roles.map((role) => ({ userId: user.id, role })), skipDuplicates: true });
      return created;
    });
    await audit(actor.id, "EMPLOYEE_CREATED", "Employee", employee.id, { employeeCode: employee.employeeCode, email });
    revalidatePath("/admin/employees");
    revalidatePath("/admin/courses");
    return { message: `${employee.name} was added successfully.` };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { message: "Employee code or email address already exists." };
    return { message: error instanceof Error ? error.message : "Employee could not be added." };
  }
}

export async function deleteEmployee(_: { message?: string }, formData: FormData) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const employeeId = String(formData.get("employeeId") ?? "");
  if (formData.get("confirmDelete") !== "on") return { message: "Tick the confirmation box before deleting." };
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: { user: { include: { roles: true } } },
  });
  if (!employee) return { message: "Employee not found." };
  if (actor.employeeId === employee.id) return { message: "You cannot delete your own employee record." };
  const isSuperAdmin = employee.user?.roles.some((grant) => grant.role === UserRole.SUPER_ADMIN) ?? false;
  if (isSuperAdmin) {
    const superAdminCount = await db.userRoleGrant.count({ where: { role: UserRole.SUPER_ADMIN } });
    if (superAdminCount <= 1) return { message: "The last Super Admin cannot be deleted." };
  }

  await db.$transaction(async (tx) => {
    if (employee.user) await tx.user.delete({ where: { id: employee.user.id } });
    await tx.employee.delete({ where: { id: employee.id } });
  });
  await audit(actor.id, "EMPLOYEE_DELETED", "Employee", employee.id, { employeeCode: employee.employeeCode, name: employee.name, email: employee.email });
  revalidatePath("/", "layout");
  return { message: `${employee.name} was deleted.` };
}

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

  // Every person id is resolved BEFORE the transaction opens. Doing it inside
  // the loop would hold a database transaction open across one network call
  // per row — a 200-row import would keep locks for as long as the slowest
  // container took to answer 200 times.
  //
  // Ten at a time: fast enough for a bulk import, gentle enough not to arrive
  // at the portal as a burst. resolvePersonId never throws, so a failure is a
  // null in the map and nothing more.
  const personIds = new Map<string, string | null>();
  for (let i = 0; i < normalized.length; i += 10) {
    const chunk = normalized.slice(i, i + 10);
    const resolved = await Promise.all(
      chunk.map((row) => resolvePersonId(row.email, row.name, row.employeeCode)),
    );
    chunk.forEach((row, index) => personIds.set(row.employeeCode, resolved[index]));
  }

  await db.$transaction(async (tx) => {
    for (const row of normalized) {
      const company = await tx.company.upsert({ where: { name: row.company }, update: {}, create: { name: row.company } });
      const personId = personIds.get(row.employeeCode) ?? null;
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
        // On update, only SET a person id — never clear one. A resolve that
        // failed this run must not wipe a link established on a previous one.
        update: {
          ...employeeData,
          companyId: company.id,
          ...(personId ? { personId } : {}),
        },
        create: { ...employeeData, companyId: company.id, personId },
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

/**
 * Pull learners straight from the shared employee master.
 *
 * LMS kept its own list, filled from an Excel upload, so the same people were
 * maintained twice and drifted apart between uploads. The master is already
 * refreshed nightly from ZingHR (on roll) and Truein (off roll), and every
 * other app on the platform reads it — this makes LMS one of them.
 *
 * The Excel upload stays. It is the only way in for a learner who is in neither
 * feed, which is a real case here: LMS is deliberately open to people the
 * employee master will never hold.
 *
 * NOT one big transaction. The first version wrapped all ~1500 upserts in one,
 * and a single e-mail collision aborted the entire import — HR pressed the
 * button and got a server error with nothing imported at all. Work is committed
 * in chunks now, so one bad row costs that chunk and nothing else, and the whole
 * operation is idempotent, so re-running finishes the job.
 */
export async function importEmployeesFromMaster(
  _: EmployeeImportState,
  formData: FormData,
): Promise<EmployeeImportState> {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  if (!masterConfigured()) {
    return { message: "The employee master is not configured for this deployment." };
  }

  // Unticking both means everybody, which is what an empty filter means to the
  // master too — better than refusing and making HR guess.
  const sources: MasterSource[] = [];
  if (formData.get("onroll") === "on") sources.push("onroll");
  if (formData.get("offroll") === "on") sources.push("offroll");

  let people;
  try {
    people = await fetchMasterEmployees(sources);
  } catch (error) {
    return { message: error instanceof Error ? error.message : "The employee master could not be reached." };
  }

  // No e-mail means no login: LMS signs people in with an emailed code, so such
  // a record could never be used.
  const withEmail = people.filter((person) => String(person.official_email_id ?? "").trim());
  const skippedNoEmail = people.length - withEmail.length;

  // One record per address. employee_master is keyed on employee_code, so two
  // codes CAN share an address — a person in both feeds, most obviously — but
  // Employee.email here is unique. Collapsing them now rather than letting the
  // database refuse turns a failure into a counted note.
  const byEmail = new Map<string, (typeof withEmail)[number]>();
  let duplicateEmails = 0;
  for (const person of withEmail) {
    const email = person.official_email_id!.trim().toLowerCase();
    const seen = byEmail.get(email);
    if (!seen) {
      byEmail.set(email, person);
      continue;
    }
    duplicateEmails += 1;
    // On roll wins: it is the fuller record and the one HR treats as primary.
    if (seen.source !== "onroll" && person.source === "onroll") byEmail.set(email, person);
  }
  if (!byEmail.size) {
    return { message: `The employee master returned ${people.length} people, none with an e-mail address.` };
  }

  // An address already held by a DIFFERENT employee code — usually a leftover
  // from the old spreadsheet import under another code. Reported rather than
  // silently rewritten: moving a code would detach that learner from their
  // enrolments and progress, which is not a decision an import should take.
  const wanted = [...byEmail.values()];
  const existing = await db.employee.findMany({
    where: {
      OR: [
        { email: { in: [...byEmail.keys()] } },
        { employeeCode: { in: wanted.map((person) => person.employee_code) } },
      ],
    },
    select: { employeeCode: true, email: true },
  });
  const codeForEmail = new Map(existing.map((row) => [row.email, row.employeeCode]));
  const knownCodes = new Set(existing.map((row) => row.employeeCode));

  const conflicts: string[] = [];
  const importable = [...byEmail.entries()].filter(([email, person]) => {
    const heldBy = codeForEmail.get(email);
    if (heldBy && heldBy !== person.employee_code) {
      conflicts.push(`${email} (here as ${heldBy}, master says ${person.employee_code})`);
      return false;
    }
    return true;
  });

  // Heal anything an earlier import split BEFORE matching, so the name we look
  // up is the survivor rather than one of the duplicates.
  const mergedCompanies = await mergeDuplicateCompanies();

  // Companies once, not once per person: ~1500 upserts for a handful of names.
  //
  // Matched against what LMS ALREADY has, loosely. The master writes "RDC
  // Concrete India Ltd." where LMS held "RDC Concrete (India) Limited", and a
  // plain upsert on the exact name made a second company for the same firm.
  // That is not cosmetic: a course offers only employees whose company is
  // linked to it, so every imported learner landed in a company no existing
  // course knew about and the enrolment picker showed nobody but the Super
  // Admins, who are exempt from the rule.
  const existingCompanies = await db.company.findMany({ select: { id: true, name: true } });
  const byNormalised = new Map(existingCompanies.map((c) => [normaliseCompany(c.name), c.id]));

  const companyIds = new Map<string, string>();
  const newCompanies: string[] = [];
  for (const name of new Set(importable.map(([, p]) => String(p.company ?? "").trim() || "Third Party"))) {
    const key = normaliseCompany(name);
    const matched = byNormalised.get(key);
    if (matched) {
      // Reuse, and never rename: HR chose the wording that is already there.
      companyIds.set(name, matched);
      continue;
    }
    const company = await db.company.create({ data: { name } });
    byNormalised.set(key, company.id);
    companyIds.set(name, company.id);
    newCompanies.push(name);
  }

  let created = 0;
  let updated = 0;
  const failedCodes: string[] = [];
  const CHUNK = 50;

  for (let start = 0; start < importable.length; start += CHUNK) {
    const chunk = importable.slice(start, start + CHUNK);
    try {
      await db.$transaction(async (tx) => {
        for (const [email, person] of chunk) {
          const companyName = String(person.company ?? "").trim() || "Third Party";
          const data = {
            name: person.employee_name,
            email,
            companyId: companyIds.get(companyName)!,
            // The master holds no department. "General" matches what the Excel
            // import already defaults to, so the two paths agree.
            department: "General",
            designation: String(person.designation ?? "").trim() || "Not specified",
            locationPlant: String(person.location ?? "").trim() || null,
            managerName: String(person.manager_name ?? "").trim() || null,
            mobileNumber: String(person.contact_number ?? "").trim() || null,
            // Joined in by the portal, so this costs no extra call per person.
            personId: person.person_id,
          };

          const employee = await tx.employee.upsert({
            where: { employeeCode: person.employee_code },
            // Roles, status, enrolments and progress belong to LMS and are
            // never touched by a refresh from the master.
            update: data,
            create: { ...data, employeeCode: person.employee_code, status: EmployeeStatus.ACTIVE },
          });
          if (knownCodes.has(person.employee_code)) updated += 1;
          else created += 1;

          const user = await tx.user.upsert({
            where: { email },
            update: { employeeId: employee.id },
            create: { email, employeeId: employee.id },
          });
          await tx.userRoleGrant.upsert({
            where: { userId_role: { userId: user.id, role: UserRole.LEARNER } },
            update: {},
            create: { userId: user.id, role: UserRole.LEARNER },
          });
        }
      }, { timeout: 60_000 });
    } catch (error) {
      // One chunk failing must not lose the rest. Named, so HR can see who.
      const codes = chunk.map(([, person]) => person.employee_code).join(", ");
      failedCodes.push(codes);
      console.error("[import-from-master] chunk failed", codes, error);
    }
  }

  await audit(actor.id, "EMPLOYEES_IMPORTED_FROM_MASTER", "Employee", undefined, {
    sources: sources.length ? sources : ["all"],
    created,
    updated,
    skippedNoEmail,
    duplicateEmails,
    conflicts: conflicts.length,
    failedChunks: failedCodes.length,
  });
  revalidatePath("/admin/employees");
  revalidatePath("/admin/courses");

  const notes: string[] = [];
  if (skippedNoEmail) notes.push(`${skippedNoEmail} skipped with no e-mail address`);
  if (duplicateEmails) notes.push(`${duplicateEmails} duplicate address${duplicateEmails === 1 ? "" : "es"} collapsed`);
  if (conflicts.length) {
    notes.push(
      `${conflicts.length} address${conflicts.length === 1 ? "" : "es"} already held by a different employee code `
        + `(${conflicts.slice(0, 3).join("; ")}${conflicts.length > 3 ? "; and more" : ""}) — `
        + "correct or delete the older record, then import again",
    );
  }
  if (failedCodes.length) notes.push(`${failedCodes.length} batch${failedCodes.length === 1 ? "" : "es"} failed, see the server log`);
  if (mergedCompanies.length) {
    notes.push(`${mergedCompanies.length} duplicate compan${mergedCompanies.length === 1 ? "y" : "ies"} merged (${mergedCompanies.join("; ")})`);
  }
  if (newCompanies.length) {
    // Said out loud because it needs an action. A course offers only employees
    // whose company is linked to it, so learners in a brand-new company are
    // invisible in the enrolment picker until somebody adds it to the course.
    notes.push(
      `new compan${newCompanies.length === 1 ? "y" : "ies"} created (${newCompanies.join(", ")}) — `
        + "add them to a course before its learners appear in the enrolment list",
    );
  }

  return {
    message: `${created} added, ${updated} updated from the employee master`
      + `${notes.length ? ` — ${notes.join("; ")}` : ""}.`,
    preview: false,
  };
}


/**
 * Fold companies that are the same firm under two spellings into one.
 *
 * Matching names on the way IN stops new duplicates; it does nothing about the
 * ones already written. The first import created "RDC Concrete India Ltd."
 * beside the existing "RDC Concrete (India) Limited", and every learner it
 * added sat in a company no course was linked to — invisible in the enrolment
 * picker, which is how this was reported.
 *
 * Idempotent: with nothing to merge it does nothing, so it is safe to run on
 * every import and heals whatever the last one split.
 *
 * The survivor is the company with the most employees, and ties go to the
 * older record — that is the one HR has been using and the one existing
 * courses are most likely already linked to. Course links move across before
 * the empty duplicate is removed, so no course loses its audience.
 */
async function mergeDuplicateCompanies(): Promise<string[]> {
  const companies = await db.company.findMany({
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { employees: true } },
    },
  });

  const candidates = companies.map((company) => ({
    id: company.id,
    name: company.name,
    createdAt: company.createdAt,
    employeeCount: company._count.employees,
  }));

  const merged: string[] = [];
  for (const group of groupDuplicateCompanies(candidates)) {
    const { keep, drop } = pickSurvivingCompany(group);

    for (const duplicate of drop) {
      await db.$transaction(async (tx) => {
        await tx.employee.updateMany({
          where: { companyId: duplicate.id },
          data: { companyId: keep.id },
        });
        // Move course links one at a time: the pair is a composite primary
        // key, so a link that already exists on the survivor would collide.
        const links = await tx.courseCompany.findMany({ where: { companyId: duplicate.id } });
        for (const link of links) {
          await tx.courseCompany.upsert({
            where: { courseId_companyId: { courseId: link.courseId, companyId: keep.id } },
            update: {},
            create: { courseId: link.courseId, companyId: keep.id },
          });
        }
        await tx.courseCompany.deleteMany({ where: { companyId: duplicate.id } });
        // Safe now: nothing points at it.
        await tx.company.delete({ where: { id: duplicate.id } });
      });
      merged.push(`${duplicate.name} into ${keep.name}`);
    }
  }
  return merged;
}
