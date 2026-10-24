/**
 * Rules for spotting one person who has two employee records, with no database
 * in sight so they can be tested on their own.
 *
 * How it happens: a person's e-mail changes (a move to a company address, a
 * corrected personal one) and a record is added for the new address, leaving the
 * old one active. Two rules cover it:
 *
 *  - SAME PORTAL PERSON ID: the portal already knows these are one person (it
 *    links by employee code across address changes). Certain, so it is acted on
 *    automatically: the older record is archived.
 *  - SAME NAME AND MOBILE with no shared person id: probably the same person,
 *    but only probably, so these are shown for an admin to confirm.
 */

export type PersonRecord = {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  mobileNumber: string | null;
  personId: string | null;
  masterSeenAt: Date | null;
  createdAt: Date;
};

/** The record to keep: the one the master saw most recently, else the newest. */
export function chooseKeeper<T extends Pick<PersonRecord, "masterSeenAt" | "createdAt" | "employeeCode">>(group: T[]): T {
  return [...group].sort((a, b) => {
    const seen = (b.masterSeenAt?.getTime() ?? 0) - (a.masterSeenAt?.getTime() ?? 0);
    if (seen) return seen;
    const created = b.createdAt.getTime() - a.createdAt.getTime();
    return created || a.employeeCode.localeCompare(b.employeeCode);
  })[0];
}

/** Records that share a portal person id, in groups of two or more. */
export function samePersonGroups<T extends Pick<PersonRecord, "personId">>(rows: T[]): T[][] {
  const byPerson = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.personId) continue;
    byPerson.set(row.personId, [...(byPerson.get(row.personId) ?? []), row]);
  }
  return [...byPerson.values()].filter((group) => group.length > 1);
}

/** The last ten digits of a phone number, so "+91 98765 43210" and "9876543210" match. */
export function normalizeMobile(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

export function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Different records with the same name and mobile that the portal has NOT
 * linked: shown as "possible duplicates" for an admin to decide on. A pair the
 * portal already links is not listed; the automatic rule handles it.
 */
export function possibleDuplicateGroups<T extends PersonRecord>(rows: T[]): T[][] {
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    const mobile = normalizeMobile(row.mobileNumber);
    const name = normalizeName(row.name);
    if (!mobile || !name) continue;
    const key = `${name}|${mobile}`;
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  return [...byKey.values()].filter((group) => {
    if (group.length < 2) return false;
    const ids = new Set(group.map((row) => row.personId).filter(Boolean));
    const allLinked = group.every((row) => row.personId) && ids.size === 1;
    return !allLinked;
  });
}
