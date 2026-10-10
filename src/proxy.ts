import { NextResponse, type NextRequest } from "next/server";

/**
 * Tells the page being rendered which path was asked for.
 *
 * A server component cannot see its own address, so when it finds nobody is
 * signed in it could only send them to a bare /login and the link they came
 * from was lost (see lib/next-path.ts). This hands the path to requireUser,
 * which sends them to /login?next=<path> instead. Nothing else happens here:
 * no redirect, no check on who is signed in.
 *
 * Always overwritten, so a browser cannot supply its own value; whatever is
 * read is also validated before it is used.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-next-path", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: not the framework's own files, the API routes (which answer
  // with a status rather than a redirect), or the public assets.
  matcher: ["/((?!_next/static|_next/image|api|brand|guides|templates|favicon.ico).*)"],
};
