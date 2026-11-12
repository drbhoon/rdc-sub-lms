import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { loginUrl } from "@/lib/next-path";
import { hasAnyEffectiveRole, hasEffectiveRole } from "@/lib/roles";
import { randomToken, tokenHash } from "@/lib/security";
import { VIEW_AS_COOKIE, readViewAsValue } from "@/lib/view-as";

export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + env.SESSION_DAYS * 86400000);
  await db.session.create({ data: { userId, tokenHash: tokenHash(token), expiresAt } });
  const jar = await cookies();
  jar.set(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(env.SESSION_COOKIE_NAME)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  jar.delete(env.SESSION_COOKIE_NAME);
}

/** Who an administrator is looking at, while they view a learner's account (see lib/view-as.ts). */
export type ViewingAs = { adminUserId: string; adminName: string; employeeId: string };

/** The person who actually signed in, with the token of their session, ignoring any view-as. */
export async function signedInUser() {
  const jar = await cookies();
  const token = jar.get(env.SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: { include: { roles: true, employee: { include: { company: true } } } } },
  });
  if (!session || session.expiresAt <= new Date() || session.user.employee?.status === "INACTIVE") return null;
  return { user: session.user, token, jar };
}

export async function currentUser() {
  const signedIn = await signedInUser();
  if (!signedIn) return null;
  const { user: real, token, jar } = signedIn;

  // An administrator looking at a learner's account: everything that asks who is signed in sees that
  // learner, but only while the signed cookie from /api/view-as/start says so, and only for an
  // administrator. They get the learner's own roles, so they see what the learner sees and nothing
  // more. Nothing can be written meanwhile (lib/db.ts).
  const target = hasEffectiveRole(real, "SUPER_ADMIN") ? readViewAsValue(jar.get(VIEW_AS_COOKIE)?.value, token, real.id) : null;
  if (target) {
    const learner = await db.user.findUnique({ where: { employeeId: target }, include: { roles: true, employee: { include: { company: true } } } });
    if (learner) {
      const viewingAs: ViewingAs = { adminUserId: real.id, adminName: real.employee?.name ?? real.email, employeeId: target };
      return { ...learner, viewingAs: viewingAs as ViewingAs | null };
    }
  }
  return { ...real, viewingAs: null as ViewingAs | null };
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) {
    // Signed out: to the login, remembering the page asked for (set by
    // src/proxy.ts), so an invite link lands on its course once they are in.
    redirect(loginUrl((await headers()).get("x-next-path")));
  }
  return user;
}

export async function requireRole(...allowed: UserRole[]) {
  const user = await requireUser();
  if (!hasAnyEffectiveRole(user, allowed)) redirect("/unauthorized");
  return user;
}

export function hasRole(user: Awaited<ReturnType<typeof currentUser>>, role: UserRole) {
  return hasEffectiveRole(user, role);
}
