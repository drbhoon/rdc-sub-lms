import { audit } from "@/lib/audit";
import { withBase } from "@/lib/base-path";
import { signedInUser } from "@/lib/session";
import { VIEW_AS_COOKIE, readViewAsValue } from "@/lib/view-as";

export const runtime = "nodejs";

/** The administrator stops looking at a learner's account and is back on that learner's activity page. */
export async function GET() {
  const signedIn = await signedInUser();
  const viewed = signedIn ? readViewAsValue(signedIn.jar.get(VIEW_AS_COOKIE)?.value, signedIn.token, signedIn.user.id) : null;
  if (signedIn && viewed) await audit(signedIn.user.id, "VIEW_AS_LEARNER_ENDED", "Employee", viewed);
  const headers = new Headers({ Location: withBase(viewed ? `/admin/learners/${viewed}` : "/admin/employees"), "Cache-Control": "private, no-store" });
  headers.append("Set-Cookie", `${VIEW_AS_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return new Response(null, { status: 303, headers });
}
