/**
 * Where to send somebody after they sign in: the page they were trying to
 * reach.
 *
 * An invite or reminder e-mail links straight to a course. Opening it signed
 * out used to land on the login page with the destination forgotten, so after
 * signing in the dashboard sent a learner to "My courses" and an admin into
 * the admin area, which the platform asks to sign in to a second time. The
 * path now travels with the login (`?next=`).
 *
 * That value comes from the browser, so it is only ever used after this says
 * it is a plain same-site path: a leading single slash and nothing that could
 * turn into another origin ("//evil.example" is a URL, not a path), or back
 * into the login itself.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
  // A path and nothing else: no scheme, host, query, or control characters.
  if (!/^\/[A-Za-z0-9/_\-.~%]*$/.test(path)) return null;
  // Back into the sign-in would loop; the root and dashboard are the default anyway.
  if (path === "/" || path === "/login" || path.startsWith("/login/") || path === "/dashboard") return null;
  return path;
}

/** The login address to send a signed-out visitor to, remembering where they were going. */
export function loginUrl(requestedPath: string | null | undefined): string {
  const next = safeNextPath(requestedPath);
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}
