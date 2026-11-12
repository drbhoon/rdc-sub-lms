import { audit } from "@/lib/audit";
import { withBase } from "@/lib/base-path";
import { db } from "@/lib/db";
import { signedInUser } from "@/lib/session";
import { hasEffectiveRole } from "@/lib/roles";
import { VIEW_AS_COOKIE, VIEW_AS_MINUTES, createViewAsValue } from "@/lib/view-as";

export const runtime = "nodejs";

/**
 * An administrator starts looking at one learner's account, read-only (see
 * lib/view-as.ts). Only a real administrator can, whoever they are viewing
 * already, and the person must have an account to look at.
 */
export async function GET(request: Request) {
  const signedIn = await signedInUser();
  if (!signedIn || !hasEffectiveRole(signedIn.user, "SUPER_ADMIN")) return new Response("Forbidden", { status: 403 });
  // A link on another site cannot start it for them.
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response("Forbidden", { status: 403 });

  const employeeId = new URL(request.url).searchParams.get("employee") ?? "";
  const learner = employeeId ? await db.user.findUnique({ where: { employeeId }, include: { employee: true } }) : null;
  if (!learner?.employee) return new Response("That person has no learner account to view.", { status: 404 });

  await audit(signedIn.user.id, "VIEW_AS_LEARNER_STARTED", "Employee", employeeId, { employeeCode: learner.employee.employeeCode });
  const headers = new Headers({ Location: withBase("/learn/courses"), "Cache-Control": "private, no-store" });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  headers.append("Set-Cookie", `${VIEW_AS_COOKIE}=${createViewAsValue(signedIn.token, signedIn.user.id, employeeId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${VIEW_AS_MINUTES * 60}${secure}`);
  return new Response(null, { status: 303, headers });
}
