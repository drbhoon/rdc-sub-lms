import { EmployeeStatus, UserRole, type Course, type Employee } from "@prisma/client";
import { after } from "next/server";
import { normaliseCompany } from "@/lib/company-merge";
import { type CourseEnrollmentRow, internEmployeeCode, nameFromEmail } from "@/lib/course-enrollment-import";
import { sendEnrollmentEmail } from "@/lib/course-notifications";
import { db } from "@/lib/db";
import { resolvePersonId } from "@/lib/identity";

export type RosterEnrolmentResult = {
  /** Learners the roster created because nobody had that e-mail yet. */
  created: number;
  enrolled: number;
  alreadyEnrolled: number;
  rowErrors: string[];
  /** Employee id for every e-mail that ended up enrolled, new or already. */
  employeeIdByEmail: Map<string, string>;
  /** People enrolled by THIS upload, who are owed the enrolment e-mail. */
  newlyEnrolled: Pick<Employee, "id" | "name" | "email">[];
};

/**
 * Enrol a list of people on a course by e-mail, admitting anyone not yet in
 * LMS as a new learner. Shared by the course-roster upload and the classroom
 * upload, so both treat a person exactly the same way.
 *
 *   1. An e-mail already on file is matched to that employee. Everything else
 *      in the row — name, company, designation — is IGNORED for that row: the
 *      record on file is the truth, and an upload must not let a stray
 *      spelling in a spreadsheet quietly overwrite it.
 *   2. An e-mail nobody has seen becomes a new learner and is enrolled in the
 *      same pass — a fixed course routinely has interns nobody has entered as
 *      an employee. See course-enrollment-import.ts for the defaults used when
 *      a genuinely new row leaves the rest blank.
 *
 * Rows are handled one at a time, each in its own small transaction. A 1500-
 * row all-in-one-transaction import once meant a single e-mail collision threw
 * the entire batch away with nothing imported (see importEmployeesFromMaster),
 * so one bad row here costs that row and nothing else.
 *
 * Sends no e-mail. The caller queues `newlyEnrolled` with queueEnrollmentEmails
 * once the page has its answer: SMTP is seconds per message, and sending 500
 * of them inside the request outlasted the proxy's timeout.
 */
export async function enrolRoster(course: Pick<Course, "id">, rows: CourseEnrollmentRow[]): Promise<RosterEnrolmentResult> {
  const courseId = course.id;
  // One row per address: a roster naming the same person twice should not be
  // read as two people.
  const byEmail = new Map(rows.map((row) => [row.email, row]));
  const emails = [...byEmail.keys()];

  const existingEmployees = await db.employee.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
  const employeeIdByEmail = new Map(existingEmployees.map((employee) => [employee.email, employee.id]));
  const newEmails = emails.filter((email) => !employeeIdByEmail.has(email));

  // Companies for the NEW people only — existing employees keep the company
  // they already have. Matched loosely against what LMS already holds, the
  // same way importEmployeesFromMaster does: "Interns" and "interns" must
  // resolve to one company, or half the batch ends up in a company no course
  // is linked to and vanishes from the enrolment picker.
  const existingCompanies = await db.company.findMany({ select: { id: true, name: true } });
  const companyIdByNormalised = new Map(existingCompanies.map((c) => [normaliseCompany(c.name), c.id]));
  const wantedCompanyNames = new Set(newEmails.map((email) => byEmail.get(email)!.company.trim() || "Interns"));
  for (const name of wantedCompanyNames) {
    const key = normaliseCompany(name);
    if (companyIdByNormalised.has(key)) continue;
    const created = await db.company.create({ data: { name } });
    companyIdByNormalised.set(key, created.id);
  }

  // Resolved OUTSIDE any transaction: it is a network call to another
  // container, and holding a database transaction open across it is how a
  // slow neighbour turns into lock contention here. Only the new people need it.
  const personIds = new Map<string, string | null>();
  for (let i = 0; i < newEmails.length; i += 10) {
    const chunk = newEmails.slice(i, i + 10);
    const resolved = await Promise.all(chunk.map((email) => {
      const row = byEmail.get(email)!;
      return resolvePersonId(email, row.name || nameFromEmail(email), row.employeeCode || undefined);
    }));
    chunk.forEach((email, index) => personIds.set(email, resolved[index]));
  }

  const existingEnrollments = await db.enrollment.findMany({
    where: { courseId, employeeId: { in: [...employeeIdByEmail.values()] } },
    select: { employeeId: true },
  });
  const enrolledEmployeeIds = new Set(existingEnrollments.map((enrollment) => enrollment.employeeId));

  const result: RosterEnrolmentResult = {
    created: 0, enrolled: 0, alreadyEnrolled: 0, rowErrors: [], employeeIdByEmail: new Map(), newlyEnrolled: [],
  };

  for (const email of emails) {
    const row = byEmail.get(email)!;
    try {
      const isNew = !employeeIdByEmail.has(email);
      const employeeId = await db.$transaction(async (tx) => {
        let id = employeeIdByEmail.get(email);
        if (!id) {
          const companyId = companyIdByNormalised.get(normaliseCompany(row.company.trim() || "Interns"))!;
          const employee = await tx.employee.create({
            data: {
              employeeCode: row.employeeCode || internEmployeeCode(email),
              name: row.name || nameFromEmail(email),
              email,
              companyId,
              department: "General",
              designation: row.designation || "Intern",
              status: EmployeeStatus.ACTIVE,
              personId: personIds.get(email) ?? null,
            },
          });
          id = employee.id;
          const user = await tx.user.upsert({
            where: { email },
            update: { employeeId: id },
            create: { email, employeeId: id },
          });
          await tx.userRoleGrant.upsert({
            where: { userId_role: { userId: user.id, role: UserRole.LEARNER } },
            update: {},
            create: { userId: user.id, role: UserRole.LEARNER },
          });
        }
        return id;
      });

      result.employeeIdByEmail.set(email, employeeId);
      if (enrolledEmployeeIds.has(employeeId)) {
        result.alreadyEnrolled += 1;
        continue;
      }
      const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { id: true, name: true, email: true } });
      await db.enrollment.create({ data: { employeeId, courseId } });
      enrolledEmployeeIds.add(employeeId);
      if (isNew) result.created += 1;
      result.enrolled += 1;
      result.newlyEnrolled.push(employee);
    } catch (error) {
      result.rowErrors.push(`${email}: ${error instanceof Error ? error.message : "could not be enrolled"}`);
    }
  }
  return result;
}

const EMAIL_CONCURRENCY = 5;

/**
 * Send enrolment e-mails after the response has gone back to the browser.
 *
 * Each one is an SMTP round trip plus a log row, so a 500-person upload spent
 * many minutes inside the request, and the proxy gave up long before it
 * finished. The enrolments are already saved by the time this runs; every
 * mail is still logged in CourseEmailLog as SENT, FAILED or SKIPPED.
 */
export function queueEnrollmentEmails(employees: Pick<Employee, "id" | "name" | "email">[], course: Pick<Course, "id" | "title" | "durationMinutes">) {
  if (!employees.length) return;
  after(async () => {
    for (let i = 0; i < employees.length; i += EMAIL_CONCURRENCY) {
      await Promise.all(employees.slice(i, i + EMAIL_CONCURRENCY).map((employee) =>
        sendEnrollmentEmail({ employee, course }).catch((error) => {
          console.error(`[enrolment-email] ${employee.email}:`, error instanceof Error ? error.message : error);
        })));
    }
  });
}
