import { createSign } from "node:crypto";

/**
 * Google Meet links made by the LMS, through Google Calendar.
 *
 * A live session needs a Meet link. Pasting one in by hand works; this makes
 * one instead: it creates a calendar event with a Meet room on the account of
 * a Workspace user (the "organiser", for example a shared learning mailbox)
 * and reads the room's link back. Rescheduling a session changes the same
 * event, and cancelling it removes the event.
 *
 * How it signs in: a Google Cloud service account that the Workspace
 * administrator has allowed to act for the organiser ("domain-wide
 * delegation", scope calendar.events). The LMS signs a short-lived assertion
 * with the account's private key and trades it for an access token, with no
 * Google client library. Nobody has to sign in with Google, and no learner's
 * account is touched. No attendees are put on the event: the LMS e-mails the
 * people itself, with a calendar entry that carries the link.
 *
 * Calls go through `fetchImpl` and a config object so the tests can run it
 * against a fake Google.
 */
export type MeetConfig = {
  clientEmail: string;
  privateKey: string;
  organizer: string;
  calendarId: string;
  tokenUrl: string;
  apiBase: string;
};

export type MeetDetails = { title: string; startsAt: Date; durationMinutes: number; description?: string };
export type Meeting = { eventId: string; meetUrl: string };

/**
 * Everything needed to call Google, or null when automatic links are not set up.
 * Read from the environment: GOOGLE_MEET_CLIENT_EMAIL, GOOGLE_MEET_PRIVATE_KEY, GOOGLE_MEET_ORGANIZER,
 * and optionally GOOGLE_MEET_CALENDAR_ID. A blank variable counts as not set, because docker-compose
 * forwards the ones the .env omits as empty. GOOGLE_TOKEN_URL and GOOGLE_CALENDAR_API exist only so a
 * test can stand in for Google.
 */
export function meetConfig(vars: Record<string, string | undefined> = process.env): MeetConfig | null {
  const get = (name: string) => (vars[name] ?? "").trim() || undefined;
  const clientEmail = get("GOOGLE_MEET_CLIENT_EMAIL");
  const key = get("GOOGLE_MEET_PRIVATE_KEY");
  const organizer = get("GOOGLE_MEET_ORGANIZER");
  if (!clientEmail || !key || !organizer) return null;
  return {
    clientEmail,
    // An env file holds the key on one line, with its line breaks written as \n.
    privateKey: key.replace(/\\n/g, "\n"),
    organizer,
    calendarId: get("GOOGLE_MEET_CALENDAR_ID") ?? "primary",
    tokenUrl: get("GOOGLE_TOKEN_URL") ?? "https://oauth2.googleapis.com/token",
    apiBase: (get("GOOGLE_CALENDAR_API") ?? "https://www.googleapis.com/calendar/v3").replace(/\/$/, ""),
  };
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** The signed request for an access token, acting as the organiser. */
export function signedAssertion(config: MeetConfig, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: config.clientEmail,
    sub: config.organizer,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: config.tokenUrl,
    iat: nowSeconds,
    exp: nowSeconds + 3000,
  }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(config.privateKey);
  return `${header}.${claims}.${base64url(signature)}`;
}

async function accessToken(config: MeetConfig, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedAssertion(config) }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null) as { access_token?: string; error?: string; error_description?: string } | null;
  if (!response.ok || !body?.access_token) {
    const reason = body?.error_description ?? body?.error ?? `status ${response.status}`;
    throw new Error(`Google refused the sign-in (${reason}). Check that the service account may act for ${config.organizer}.`);
  }
  return body.access_token;
}

type CalendarEvent = { id?: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] } };

const meetUrlOf = (event: CalendarEvent) =>
  event.hangoutLink ?? event.conferenceData?.entryPoints?.find((point) => point.entryPointType === "video")?.uri ?? null;

function eventBody(details: MeetDetails) {
  const end = new Date(details.startsAt.getTime() + details.durationMinutes * 60_000);
  return {
    summary: details.title,
    description: details.description ?? "",
    start: { dateTime: details.startsAt.toISOString(), timeZone: "Asia/Kolkata" },
    end: { dateTime: end.toISOString(), timeZone: "Asia/Kolkata" },
  };
}

async function call(config: MeetConfig, token: string, fetchImpl: typeof fetch, method: string, path: string, body?: object): Promise<CalendarEvent | null> {
  const response = await fetchImpl(`${config.apiBase}/calendars/${encodeURIComponent(config.calendarId)}/events${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 204 || (method === "DELETE" && (response.status === 404 || response.status === 410))) return null;
  const data = await response.json().catch(() => null) as (CalendarEvent & { error?: { message?: string } }) | null;
  if (!response.ok) throw new Error(`Google Calendar said no (${data?.error?.message ?? `status ${response.status}`}).`);
  return data;
}

/** A calendar event with a Meet room. Returns the event (to change or remove it later) and the room's link. */
export async function createMeeting(config: MeetConfig, details: MeetDetails, fetchImpl: typeof fetch = fetch): Promise<Meeting> {
  const token = await accessToken(config, fetchImpl);
  const requestId = `rdc-lms-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let event = await call(config, token, fetchImpl, "POST", "?conferenceDataVersion=1&sendUpdates=none", {
    ...eventBody(details),
    conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
  });
  // The room is normally ready in the reply; when Google is still setting it up, ask again a moment later.
  for (let attempt = 0; event?.id && !meetUrlOf(event) && attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    event = await call(config, token, fetchImpl, "GET", `/${encodeURIComponent(event.id)}`);
  }
  const meetUrl = event ? meetUrlOf(event) : null;
  if (!event?.id || !meetUrl) throw new Error("Google made the event but no Meet link came back. Is Google Meet switched on for the organiser's account?");
  return { eventId: event.id, meetUrl };
}

/** Move the event: new title, time or length. The Meet room and its link stay the same. */
export async function updateMeeting(config: MeetConfig, eventId: string, details: MeetDetails, fetchImpl: typeof fetch = fetch): Promise<void> {
  const token = await accessToken(config, fetchImpl);
  await call(config, token, fetchImpl, "PATCH", `/${encodeURIComponent(eventId)}?sendUpdates=none`, eventBody(details));
}

/** Remove the event, and with it the Meet room. Already gone counts as removed. */
export async function cancelMeeting(config: MeetConfig, eventId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const token = await accessToken(config, fetchImpl);
  await call(config, token, fetchImpl, "DELETE", `/${encodeURIComponent(eventId)}?sendUpdates=none`);
}
