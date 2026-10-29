import { EmployeeStatus, UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { chooseKeeper, normalizeName, possibleDuplicateGroups, sameNameGroups, samePersonGroups, suggestKeeper } from "@/lib/employee-duplicates";

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
export const REASON_NOT_IN_MASTER = "Archived: not in master";
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

export type SameNameRecord = {
  id: string; employeeCode: string; name: string; email: string; mobileNumber: string | null;
  company: string; designation: string; department: string; source: string | null; inMaster: boolean;
  createdAt: Date; enrollments: number; activity: number;
};
export type SameNameGroup = { records: SameNameRecord[]; keeperId: string };

/**
 * People who share a name where at least one record is not the master's: the
 * duplicates an upload leaves behind. With, for each record, how much learning
 * is on it, so what is removed can be chosen knowing what it holds.
 */
export async function findSameNameRecords(seenCutoff: Date | null): Promise<SameNameGroup[]> {
  const rows = await db.employee.findMany({
    where: currentRecords,
    select: {
      id: true, employeeCode: true, name: true, email: true, mobileNumber: true, personId: true, masterSeenAt: true, createdAt: true,
      source: true, designation: true, department: true, company: { select: { name: true } },
      enrollments: { select: { _count: { select: { progress: true } } } },
      _count: { select: { assessmentAttempts: true, feedbackResponses: true, aiInteractions: true } },
    },
  });
  const records = rows.map((row) => ({
    ...row,
    inMaster: Boolean(seenCutoff && row.masterSeenAt && row.masterSeenAt >= seenCutoff),
  }));
  return sameNameGroups(records).map((group) => {
    const detailed: SameNameRecord[] = group.map((row) => ({
      id: row.id, employeeCode: row.employeeCode, name: row.name, email: row.email, mobileNumber: row.mobileNumber,
      company: row.company.name, designation: row.designation, department: row.department, source: row.source, inMaster: row.inMaster,
      createdAt: row.createdAt, enrollments: row.enrollments.length,
      activity: row.enrollments.reduce((sum, enrollment) => sum + enrollment._count.progress, 0)
        + row._count.assessmentAttempts + row._count.feedbackResponses + row._count.aiInteractions,
    }));
    return { records: detailed, keeperId: suggestKeeper(detailed).id };
  }).sort((a, b) => a.records[0].name.localeCompare(b.records[0].name));
}

export type RemovalOutcome = { deleted: number; archived: number; enrollmentsCarried: number; skipped: string[] };

/**
 * Get rid of the extra record of someone who is here twice. Each pair says
 * which record goes and which one stays. A record with no learning on it is
 * deleted; one with any is archived instead, so nothing anyone did is lost.
 * Either way the learner keeps their courses: enrolments the staying record
 * lacks are carried over first.
 */
export async function removeDuplicateRecords(pairs: { id: string; keepId: string }[], actorEmployeeId: string | null): Promise<RemovalOutcome> {
  const outcome: RemovalOutcome = { deleted: 0, archived: 0, enrollmentsCarried: 0, skipped: [] };
  for (const pair of pairs) {
    if (pair.id === pair.keepId) continue;
    const [duplicate, keeper] = await Promise.all([
      db.employee.findUnique({
        where: { id: pair.id },
        include: {
          user: { include: { roles: true } }, enrollments: { include: { _count: { select: { progress: true } } } },
          _count: { select: { assessmentAttempts: true, feedbackResponses: true, aiInteractions: true } },
        },
      }),
      db.employee.findUnique({ where: { id: pair.keepId }, include: { enrollments: { select: { courseId: true } } } }),
    ]);
    if (!duplicate || !keeper) continue;
    const label = `${duplicate.name} (${duplicate.employeeCode})`;
    if (duplicate.id === actorEmployeeId) { outcome.skipped.push(`${label}: your own record`); continue; }
    if (keeper.archivedAt || normalizeName(keeper.name) !== normalizeName(duplicate.name)) { outcome.skipped.push(`${label}: the record to keep is not a current record of the same name`); continue; }
    if (duplicate.user?.roles.some((grant) => grant.role === UserRole.SUPER_ADMIN || grant.role === UserRole.TEACHER)) {
      outcome.skipped.push(`${label}: holds a Teacher or Super Admin role; move the role to the other record first`);
      continue;
    }

    const have = new Set(keeper.enrollments.map((enrollment) => enrollment.courseId));
    const carry = duplicate.enrollments.filter((enrollment) => !have.has(enrollment.courseId));
    if (carry.length) {
      await db.enrollment.createMany({ data: carry.map((enrollment) => ({ employeeId: keeper.id, courseId: enrollment.courseId, classroomId: enrollment.classroomId })), skipDuplicates: true });
      outcome.enrollmentsCarried += carry.length;
    }
    const activity = duplicate.enrollments.reduce((sum, enrollment) => sum + enrollment._count.progress, 0)
      + duplicate._count.assessmentAttempts + duplicate._count.feedbackResponses + duplicate._count.aiInteractions;
    if (activity > 0) {
      await archiveEmployees([duplicate.id], reasonReplacedBy(keeper.employeeCode));
      outcome.archived += 1;
    } else {
      await db.$transaction(async (tx) => {
        if (duplicate.user) await tx.user.delete({ where: { id: duplicate.user.id } });
        await tx.employee.delete({ where: { id: duplicate.id } });
      });
      outcome.deleted += 1;
    }
  }
  return outcome;
}

/** Archive current people the master does not know. `eligible` narrows to what the caller allowed (never staff with roles, never oneself). */
export async function notInMasterArchivable(seenCutoff: Date, ids: string[], actorEmployeeId: string | null): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await db.employee.findMany({
    where: {
      id: { in: ids, ...(actorEmployeeId ? { not: actorEmployeeId } : {}) },
      archivedAt: null,
      OR: [{ masterSeenAt: null }, { masterSeenAt: { lt: seenCutoff } }],
      NOT: { user: { roles: { some: { role: { in: [UserRole.SUPER_ADMIN, UserRole.TEACHER] } } } } },
    },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** "In the master" means stamped in the latest sync run (within ten minutes of the newest stamp). Null until a sync has ever run. */
export async function masterSeenCutoff(): Promise<Date | null> {
  const lastSeen = (await db.employee.aggregate({ _max: { masterSeenAt: true } }))._max.masterSeenAt;
  return lastSeen ? new Date(lastSeen.getTime() - 10 * 60 * 1000) : null;
}
