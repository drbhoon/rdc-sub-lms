import { cookies } from "next/headers";
import { audit } from "@/lib/audit";
import { withBase } from "@/lib/base-path";
import { db } from "@/lib/db";
import { loginUrl, safeNextPath } from "@/lib/next-path";
import { readPortalPass } from "@/lib/portal-pass";
import { tokenHash } from "@/lib/security";
import { createSession, signedInUser } from "@/lib/session";
import { VIEW_AS_COOKIE } from "@/lib/view-as";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/from-portal?pass=…&next=/learn/courses/<id>
 *
 * Where a course link on hr.rdcc.ai/employees lands. The employee signed in to
 * the portal with their company Google account a moment ago, so the portal's
 * pass (lib/portal-pass.ts) is taken in place of the e-mail code and the
 * course opens.
 *
 * Only for learners and teachers. An LMS Admin or Super Admin still signs in
 * with the code, so the portal can never open the admin side of the LMS. When
 * anything is not right (pass run out or used, no account, account inactive)
 * they are sent to the normal sign-in with the course remembered, exactly as
 * before this route existed; nothing is refused that used to work.
 */

function goTo(path: string) {
  return new Response(null, { status: 303, headers: { Location: withBase(path), "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const next = safeNextPath(params.get("next")) ?? "/learn/courses";
  const fallback = () => goTo(loginUrl(next));

  // Another site cannot sign somebody in as the holder of a pass it obtained.
  if (request.headers.get("sec-fetch-site") === "cross-site") return fallback();

  const jar = await cookies();
  // An administrator's read-only view of a learner is running in this browser:
  // nothing may be written, so leave them to the normal sign-in.
  if (jar.has(VIEW_AS_COOKIE)) return fallback();

  const pass = readPortalPass(params.get("pass"));
  if (!pass) return fallback();

  const user = await db.user.findUnique({ where: { email: pass.email }, include: { roles: true, employee: true } });
  const roles = new Set(user?.roles.map((grant) => grant.role));
  if (
    !user?.employee ||
    user.employee.status !== "ACTIVE" ||
    user.employee.archivedAt ||
    roles.has("SUPER_ADMIN") ||
    roles.has("ADMIN")
  ) {
    return fallback();
  }

  const current = await signedInUser();
  if (current?.user.id !== user.id) {
    // Somebody else signed in on this browser: their session ends, as it would on sign-out.
    if (current) await db.session.deleteMany({ where: { tokenHash: tokenHash(current.token) } });
    await createSession(user.id);
    await audit(user.id, "SIGNED_IN_FROM_PORTAL", "User", user.id, { next });
  }
  return goTo(next);
}
