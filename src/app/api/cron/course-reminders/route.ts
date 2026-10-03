import { env } from "@/lib/env";
import { runCourseReminders } from "@/lib/reminder-run";

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return "";
}

function isAuthorized(request: Request) {
  if (!env.CRON_SECRET) return process.env.NODE_ENV !== "production";
  const url = new URL(request.url);
  const token = request.headers.get("x-cron-secret") || bearerToken(request) || url.searchParams.get("secret");
  return token === env.CRON_SECRET;
}

/**
 * Manual trigger for the daily reminders. The worker runs them itself every
 * morning (see worker/index.ts), so nothing outside needs to call this; it
 * stays for an operator who wants to send them now, and for any deployment
 * that prefers an external scheduler.
 */
export async function GET(request: Request) {
  if (!env.CRON_SECRET && process.env.NODE_ENV === "production") return new Response("CRON_SECRET is required in production", { status: 503 });
  if (!isAuthorized(request)) return new Response("Forbidden", { status: 403 });
  return Response.json({ status: "ok", ...await runCourseReminders() });
}
