import { EmployeeStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { chooseKeeper, samePersonGroups, possibleDuplicateGroups } from "@/lib/employee-duplicates";

/**
 * Moving people out of, and back into, the active list.
 *
 * "Archived" means: no longer current. They left, a newer record replaced them,
 * or an admin archived them. Nothing is deleted: enrolments, progress, results
 * and certificates stay and still appear in reports. What changes is that the
 * person is INACTIVE (so cannot sign in or be enrolled) and is hidden from the
 * Employees list, which is what kept leavers cluttering it.
 */

export const REASON_LEFT = "Left (master)";
export const REASON_ADMIN = "Archived by admin";
export const reasonReplacedBy = (code: string) => `Replaced by ${code}`;

/** Archive these employees. Returns how many were actually moved (already-archived ones are left alone). */
export async function archiveEmployees(ids: string[], reason: string): Promise<number> {
  if (!ids.length) return 0;
  const moved = await db.employee.updateMany({
    where: { id: { in: ids }, archivedAt: null },
    data: { status: EmployeeStatus.INACTIVE, archivedAt: new Date(), archiveReason: reason },
  });
  // Signed-in sessions end now rather than at expiry.
  await db.session.deleteMany({ where: { user: { employeeId: { in: ids } } } });
  return moved.count;
}

/** Bring one archived person back as an active employee. */
export async function restoreEmployee(id: string): Promise<boolean> {
  const restored = await db.employee.updateMany({
    where: { id, archivedAt: { not: null } },
    data: { status: EmployeeStatus.ACTIVE, archivedAt: null, archiveReason: null },
  });
  return restored.count > 0;
}

const currentRecords = {
  status: EmployeeStatus.ACTIVE,
  archivedAt: null,
} as const;

/**
 * One person, two current records (same portal person id): keep the one the
 * master saw most recently, or the newest, and archive the rest. Safe to run
 * any time and over and over: with nothing duplicated it does nothing.
 */
export async function retireDuplicateEmployees(): Promise<{ archivedCode: string; keptCode: string }[]> {
  const rows = await db.employee.findMany({
    where: { ...currentRecords, personId: { not: null } },
    select: { id: true, employeeCode: true, name: true, email: true, mobileNumber: true, personId: true, masterSeenAt: true, createdAt: true },
  });
  const done: { archivedCode: string; keptCode: string }[] = [];
  for (const group of samePersonGroups(rows)) {
    const keeper = chooseKeeper(group);
    for (const other of group.filter((row) => row.id !== keeper.id)) {
      await archiveEmployees([other.id], reasonReplacedBy(keeper.employeeCode));
      done.push({ archivedCode: other.employeeCode, keptCode: keeper.employeeCode });
    }
  }
  return done;
}

export type PossibleDuplicate = { id: string; employeeCode: string; name: string; email: string; mobileNumber: string | null; createdAt: Date; masterSeenAt: Date | null };

/** Same name and mobile but not linked by the portal: for an admin to confirm. */
export async function findPossibleDuplicates(): Promise<PossibleDuplicate[][]> {
  const rows = await db.employee.findMany({
    where: { ...currentRecords, mobileNumber: { not: null } },
    select: { id: true, employeeCode: true, name: true, email: true, mobileNumber: true, personId: true, masterSeenAt: true, createdAt: true },
  });
  return possibleDuplicateGroups(rows).map((group) => group.map((row) => ({
    id: row.id, employeeCode: row.employeeCode, name: row.name, email: row.email,
    mobileNumber: row.mobileNumber, createdAt: row.createdAt, masterSeenAt: row.masterSeenAt,
  })));
}
