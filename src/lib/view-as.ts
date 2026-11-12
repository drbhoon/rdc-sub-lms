import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * "View as learner": an administrator sees the portal exactly as one learner
 * does, without being them.
 *
 * It is READ-ONLY. While it is on, nothing can be written to the database, so
 * an administrator cannot start a quiz, mark a lesson done, ask the AI or send
 * feedback in the learner's name. That is enforced in three places that do not
 * trust each other: the proxy marks every request made in this mode, the
 * database client refuses any write on a marked request, and the actions that
 * report progress in the background answer quietly instead of failing.
 *
 * The cookie holds who is being viewed and until when, signed with a key that
 * only the administrator's own session cookie can make, so it cannot be forged
 * or carried to another session, and signing out ends it.
 *
 * No imports from the app here: the proxy and the tests use this too.
 */
export const VIEW_AS_COOKIE = "rdc_lms_viewas";
/** The header the proxy sets on requests made in this mode (and always removes otherwise). */
export const VIEW_ONLY_HEADER = "x-view-only";
/** How long one viewing lasts before the administrator has to start again. */
export const VIEW_AS_MINUTES = 120;

const sign = (sessionToken: string, adminUserId: string, employeeId: string, expiresMs: number) =>
  createHmac("sha256", sessionToken).update(`viewas|${adminUserId}|${employeeId}|${expiresMs}`).digest("base64url");

export function createViewAsValue(sessionToken: string, adminUserId: string, employeeId: string, now = Date.now()): string {
  const expiresMs = now + VIEW_AS_MINUTES * 60_000;
  return `${employeeId}.${expiresMs}.${sign(sessionToken, adminUserId, employeeId, expiresMs)}`;
}

/** The employee being viewed, or null when the cookie is missing, altered, expired or from another session. */
export function readViewAsValue(value: string | undefined, sessionToken: string, adminUserId: string, now = Date.now()): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [employeeId, expires, signature] = parts;
  const expiresMs = Number(expires);
  if (!employeeId || !Number.isFinite(expiresMs) || expiresMs <= now) return null;
  const expected = Buffer.from(sign(sessionToken, adminUserId, employeeId, expiresMs));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return employeeId;
}

const WRITE_OPERATIONS = new Set([
  "create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany",
  "$executeRaw", "$executeRawUnsafe",
]);

/** Whether a database operation changes data. */
export function isWriteOperation(operation: string): boolean {
  return WRITE_OPERATIONS.has(operation);
}

export class ViewOnlyError extends Error {
  constructor() {
    super("This is a view-only look at a learner's account. Nothing can be changed from here.");
    this.name = "ViewOnlyError";
  }
}
