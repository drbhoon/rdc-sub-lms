import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { randomToken, tokenHash } from "@/lib/security";

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

export async function currentUser() {
  const jar = await cookies();
  const token = jar.get(env.SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: { include: { roles: true, employee: { include: { company: true } } } } },
  });
  if (!session || session.expiresAt <= new Date() || session.user.employee?.status === "INACTIVE") return null;
  return session.user;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(...allowed: UserRole[]) {
  const user = await requireUser();
  if (!user.roles.some(({ role }) => allowed.includes(role))) redirect("/unauthorized");
  return user;
}

export function hasRole(user: Awaited<ReturnType<typeof currentUser>>, role: UserRole) {
  return Boolean(user?.roles.some((grant) => grant.role === role));
}
