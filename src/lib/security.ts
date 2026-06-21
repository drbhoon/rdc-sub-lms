import { createHash, randomBytes, randomInt } from "node:crypto";

export function randomToken() {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function generateOtp() {
  return randomInt(100000, 1000000).toString();
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}
