import { createHash } from "node:crypto";
import { normalizeEmail } from "./security";
import { type ImportRow, normalizeHeader } from "./tabular-import";

/**
 * One row from a course-roster upload.
 *
 * Only e-mail is required. Everything else is here to LABEL a person who
 * turns out to be new — a fixed course can have interns nobody has entered as
 * an employee yet, and this is meant to admit them rather than bounce the
 * whole file back to whoever is running the training.
 */
export type CourseEnrollmentRow = {
  email: string;
  name: string;
  employeeCode: string;
  company: string;
  designation: string;
};

const HEADINGS = ["EMAIL", "NAME", "EMP_CODE", "COMPANY", "DESIGNATION"] as const;

const aliases: Record<string, string> = {
  EMAILID: "EMAIL",
  EMAIL_ID: "EMAIL",
  E_MAIL: "EMAIL",
  EMPLOYEE_NAME: "NAME",
  FULL_NAME: "NAME",
  EMPLOYEE_CODE: "EMP_CODE",
  EMPCODE: "EMP_CODE",
  CODE: "EMP_CODE",
  DESIGNATION_TITLE: "DESIGNATION",
  DESIGNATION_ROLE: "DESIGNATION",
};

function canonicalHeader(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  return aliases[normalized] ?? normalized;
}

/**
 * Read one row loosely by column NAME rather than position, so a roster built
 * from a different template (extra columns, different order) still works as
 * long as the headings are recognisable.
 */
export function parseCourseEnrollmentRow(row: ImportRow): CourseEnrollmentRow {
  const values = Object.fromEntries(Object.entries(row).map(([key, value]) => [canonicalHeader(key), String(value ?? "").trim()]));
  return {
    email: normalizeEmail(values.EMAIL ?? ""),
    name: values.NAME ?? "",
    employeeCode: values.EMP_CODE ?? "",
    company: values.COMPANY ?? "",
    designation: values.DESIGNATION ?? "",
  };
}

export function hasEmailColumn(row: ImportRow) {
  return Object.keys(row).some((key) => normalizeHeader(canonicalHeader(key)) === normalizeHeader("EMAIL"));
}

/**
 * A stable, readable employee code for someone the roster admits who has no
 * record anywhere yet.
 *
 * Derived from the e-mail address rather than drawn at random: re-uploading
 * the same file after a partial failure lands the same person on the same
 * code instead of minting a second one, and INTERN- makes it obvious in every
 * report and dropdown that this is not an on-roll or off-roll code from the
 * employee master.
 */
export function internEmployeeCode(email: string): string {
  const digest = createHash("sha256").update(email).digest("hex").slice(0, 8).toUpperCase();
  return `INTERN-${digest}`;
}

/** "priya.sharma" -> "Priya Sharma" — used only when a genuinely new person left the name blank. */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0];
  const parts = local ? local.split(/[._-]+/).filter(Boolean) : [];
  // No usable local part (a malformed "@example.com") or nothing left after
  // splitting ("..."@example.com) — the raw address is still better than
  // nothing, and better than re-splitting the whole address including the
  // domain, which is what fell through to here before.
  if (!parts.length) return email;
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export { HEADINGS as courseEnrollmentColumns };
