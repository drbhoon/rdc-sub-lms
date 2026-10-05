import { scheduledTime } from "@/lib/daily-schedule";
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
  // A Railway test copy sends nothing unless REMINDER_TIME_IST is set there on
  // purpose. An outside scheduler pointed at it used to e-mail real people
  // from the test address, so the call is answered but does nothing.
  if (!scheduledTime(env.REMINDER_TIME_IST, "09:00", Boolean(env.RAILWAY_ENVIRONMENT))) {
    return Response.json({ status: "disabled", sent: 0, reason: "Reminders are switched off on this deployment." });
  }
  return Response.json({ status: "ok", ...await runCourseReminders() });
}
