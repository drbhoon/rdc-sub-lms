import { EmployeeStatus, UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { groupDuplicateCompanies, normaliseCompany, pickSurvivingCompany } from "@/lib/company-merge";
import { fetchMasterEmployees, masterConfigured, type MasterSource } from "@/lib/master";

/**
 * Bring LMS's employee list in line with the shared employee master.
 *
 * The master is refreshed nightly from ZingHR (on roll) and Truein (off roll)
 * and LMS used to be updated from it only when an admin pressed the button, so
 * the two drifted apart in between — LMS showed fewer people than the master.
 * This is that button's work, lifted out of the server action so the worker
 * can do it every morning as well.
 *
 * The Excel upload stays. It is the only way in for a learner who is in
 * neither feed, which is a real case here: LMS is deliberately open to people
 * the employee master will never hold. For that reason nobody is ever
 * deactivated for being absent from the master.
 *
 * NOT one big transaction. The first version wrapped all ~1500 upserts in one,
 * and a single e-mail collision aborted the entire import. Work is committed
 * in chunks, so one bad row costs that chunk and nothing else, and the whole
 * operation is idempotent, so re-running finishes the job.
 */

export class MasterUnavailableError extends Error {}

export type MasterSyncResult = {
  created: number;
  updated: number;
  /** Everyone the master returned, before LMS dropped the ones it cannot use. */
  received: number;
  skippedNoEmail: number;
  duplicateEmails: number;
  conflicts: number;
  failedChunks: number;
  notes: string[];
  /** One readable sentence for a screen or a log line. */
  summary: string;
};

/**
 * Throws MasterUnavailableError when the master is not configured or cannot be
 * read, so a caller that retries (the worker) can tell that apart from a
 * successful run that simply had nothing to do.
 */
export async function syncEmployeesFromMaster(sources: MasterSource[] = []): Promise<MasterSyncResult> {
  if (!masterConfigured()) {
    throw new MasterUnavailableError("The employee master is not configured for this deployment.");
  }

  let people;
  try {
    people = await fetchMasterEmployees(sources);
  } catch (error) {
    throw new MasterUnavailableError(error instanceof Error ? error.message : "The employee master could not be reached.");
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
    throw new MasterUnavailableError(`The employee master returned ${people.length} people, none with an e-mail address.`);
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
      console.error("[master-sync] chunk failed", codes, error);
    }
  }

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
    created,
    updated,
    received: people.length,
    skippedNoEmail,
    duplicateEmails,
    conflicts: conflicts.length,
    failedChunks: failedCodes.length,
    notes,
    summary: `${created} added, ${updated} updated from the employee master`
      + `${notes.length ? ` — ${notes.join("; ")}` : ""}.`,
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
