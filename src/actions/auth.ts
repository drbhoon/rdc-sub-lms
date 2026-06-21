"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendOtpEmail } from "@/lib/mail";
import { generateOtp, normalizeEmail } from "@/lib/security";
import { createSession, destroySession } from "@/lib/session";

export type AuthState = { ok?: boolean; message?: string; email?: string };

export async function requestOtp(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const generic = { ok: true, email, message: "If this email is eligible, a login code has been sent." };
  if (!email.includes("@")) return { message: "Enter a valid email address." };

  const user = await db.user.findUnique({ where: { email }, include: { employee: true, roles: true, otpChallenges: { orderBy: { createdAt: "desc" }, take: 1 } } });
  const isAdmin = user?.roles.some((r) => r.role === "SUPER_ADMIN");
  if (!user || (!isAdmin && user.employee?.status !== "ACTIVE")) return generic;

  const latest = user.otpChallenges[0];
  if (latest && Date.now() - latest.createdAt.getTime() < env.OTP_RESEND_SECONDS * 1000) {
    return { message: `Please wait ${env.OTP_RESEND_SECONDS} seconds before requesting another code.`, email };
  }

  const headerStore = await headers();
  const requestIp = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (requestIp) {
    const since = new Date(Date.now() - 15 * 60_000);
    const count = await db.otpChallenge.count({ where: { requestIp, createdAt: { gte: since } } });
    if (count >= 10) return { message: "Too many login requests. Try again later." };
  }

  const otp = generateOtp();
  const hash = await bcrypt.hash(otp, 12);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000);
  const challenge = await db.$transaction(async (tx) => {
    await tx.otpChallenge.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    return tx.otpChallenge.create({ data: { userId: user.id, hash, expiresAt, requestIp } });
  });
  try {
    await sendOtpEmail(email, otp);
  } catch {
    await db.otpChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
    return { message: "Email delivery is unavailable. Please contact the administrator." };
  }
  return generic;
}

export async function verifyOtp(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const otp = String(formData.get("otp") ?? "").trim();
  const user = await db.user.findUnique({ where: { email }, include: { otpChallenges: { where: { usedAt: null }, orderBy: { createdAt: "desc" }, take: 1 } } });
  const challenge = user?.otpChallenges[0];
  if (!user || !challenge || challenge.expiresAt <= new Date() || challenge.attempts >= env.OTP_MAX_ATTEMPTS) return { message: "The code is invalid or expired.", email };

  const valid = await bcrypt.compare(otp, challenge.hash);
  if (!valid) {
    await db.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    return { message: "The code is invalid or expired.", email };
  }
  await db.otpChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
  await createSession(user.id);
  redirect("/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
