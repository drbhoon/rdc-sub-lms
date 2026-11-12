import { NextResponse, type NextRequest } from "next/server";
import { VIEW_AS_COOKIE, VIEW_ONLY_HEADER } from "@/lib/view-as";

/**
 * Tells the page being rendered which path was asked for, and whether an
 * administrator is looking at a learner's account.
 *
 * A server component cannot see its own address, so when it finds nobody is
 * signed in it could only send them to a bare /login and the link they came
 * from was lost (see lib/next-path.ts). This hands the path to requireUser,
 * which sends them to /login?next=<path> instead. Nothing else is decided
 * here: no redirect, no check on who is signed in.
 *
 * Both values are always overwritten (or removed), so a browser cannot supply
 * its own. `x-view-only` is set for every request that carries the view-as
 * cookie, pages and API routes alike, and the database client then refuses any
 * write on it (lib/view-as.ts). The cookie is only checked for being present
 * here, which can only make a request MORE restricted; whether it is genuine
 * is decided where the account is chosen (lib/session.ts). The two routes that
 * start and end the mode are left unmarked so they can write their audit record.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-next-path", request.nextUrl.pathname);
  if (request.cookies.has(VIEW_AS_COOKIE) && !request.nextUrl.pathname.startsWith("/api/view-as/")) headers.set(VIEW_ONLY_HEADER, "1");
  else headers.delete(VIEW_ONLY_HEADER);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages and API routes: not the framework's own files or the public assets.
  matcher: ["/((?!_next/static|_next/image|brand|guides|templates|favicon.ico).*)"],
};
