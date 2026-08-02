/**
 * The LMS is mounted under a path prefix on the HR platform
 * (hr.rdcc.ai/lms), and at the root locally and on Railway.
 *
 * Next.js rewrites <Link>, router.push() and Server Action endpoints
 * automatically. Plain <a href="/..."> does NOT get the prefix, so those go
 * through withBase(). Empty prefix = unchanged, so root-mounted deployments
 * behave exactly as before.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function withBase(path: string): string {
  if (!BASE_PATH || !path.startsWith("/")) return path;
  return path.startsWith(`${BASE_PATH}/`) ? path : `${BASE_PATH}${path}`;
}
