import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The pass the HR portal hands an employee who clicks a course on their
 * hr.rdcc.ai/employees page.
 *
 * They have already signed in to the portal with their company Google account,
 * and the portal has matched that address to an active on-roll person. Asking
 * them for an e-mail code again, only to open a course of their own, proved
 * nothing new. So the portal signs a pass that says "this is <e-mail>", the
 * LMS checks it here and opens the course.
 *
 * The pass is good for two minutes and once only. It is signed with a key
 * derived from MASTER_API_KEY, which only the platform's own apps hold, for
 * this one purpose: nothing else signed with that key is accepted as a pass,
 * and a pass is no use anywhere else. The portal builds the same thing in
 * rdc-hr-portal/lib/lms-pass.ts.
 */

const PURPOSE = "employee-portal lms sign-in v1";
export const PASS_SECONDS = 120;

function passKey(): Buffer | null {
  const master = process.env.MASTER_API_KEY;
  if (!master) return null;
  return createHmac("sha256", master).update(PURPOSE).digest();
}

/** Passes already used, until they would have run out anyway. One LMS process, so memory is enough. */
const used = new Map<string, number>();

function forgetOld(now: number) {
  for (const [id, until] of used) if (until <= now) used.delete(id);
}

export type PortalPass = { email: string };

/** The e-mail the pass vouches for, or null when it is not genuine, has run out or was used before. */
export function readPortalPass(raw: string | null | undefined, now = Date.now()): PortalPass | null {
  const key = passKey();
  if (!key || !raw) return null;
  const [body, signature, extra] = raw.split(".");
  if (!body || !signature || extra !== undefined) return null;

  const expected = createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let claims: { email?: unknown; exp?: unknown; jti?: unknown; aud?: unknown };
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (claims.aud !== "lms") return null;
  if (typeof claims.email !== "string" || typeof claims.jti !== "string" || typeof claims.exp !== "number") return null;
  // Not yet run out, and not dated further ahead than a pass is ever made for.
  if (claims.exp * 1000 <= now || claims.exp * 1000 > now + (PASS_SECONDS + 30) * 1000) return null;

  forgetOld(now);
  if (used.has(claims.jti)) return null;
  used.set(claims.jti, claims.exp * 1000);

  const email = claims.email.trim().toLowerCase();
  return email.includes("@") ? { email } : null;
}
