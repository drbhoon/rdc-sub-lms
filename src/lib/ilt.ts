/**
 * Live (instructor-led) sessions: the rules that need no database.
 *
 * A session is a lesson that is completed by being there. Google Meet cannot
 * tell us who attended unless the organisation's Workspace reports are wired in,
 * so the instructor confirms attendance; pressing "Join" is only recorded as a hint.
 */

/** Learners may join from this long before the start. */
export const JOIN_OPENS_BEFORE_MINUTES = 15;
/** …and until this long after the planned end (sessions overrun). */
export const JOIN_CLOSES_AFTER_MINUTES = 60;

export type SessionTiming = { startsAt: Date; durationMinutes: number; cancelledAt: Date | null };
export type SessionPhase = "cancelled" | "upcoming" | "open" | "live" | "ended";

/** Where a session is in time. "open" is the quarter hour before it starts; "live" is while it runs. */
export function sessionPhase(session: SessionTiming, now: Date): SessionPhase {
  if (session.cancelledAt) return "cancelled";
  const start = session.startsAt.getTime();
  const end = start + session.durationMinutes * 60_000;
  const t = now.getTime();
  if (t < start - JOIN_OPENS_BEFORE_MINUTES * 60_000) return "upcoming";
  if (t < start) return "open";
  if (t <= end + JOIN_CLOSES_AFTER_MINUTES * 60_000) return "live";
  return "ended";
}

/** Whether the Join button should work. */
export const canJoin = (phase: SessionPhase) => phase === "open" || phase === "live";

export type MeetLink = { ok: true; url: string } | { ok: false; message: string };

/**
 * A Google Meet link: https://meet.google.com/abc-defg-hij, optionally with
 * ?authuser=1 and the like. Anything else is refused so a typo does not reach
 * forty learners; the one extra form accepted is the "lookup" link a calendar makes.
 */
export function parseMeetLink(input: string): MeetLink {
  const text = input.trim();
  if (!text) return { ok: false, message: "Paste the Google Meet link of the session." };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, message: "That does not look like a link." };
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "meet.google.com") {
    return { ok: false, message: "Use a Google Meet link, which starts with https://meet.google.com/" };
  }
  const code = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(code) && !/^lookup\/[A-Za-z0-9_-]+$/.test(code)) {
    return { ok: false, message: "The Meet link should look like https://meet.google.com/abc-defg-hij" };
  }
  return { ok: true, url: `https://meet.google.com/${code}${url.search}` };
}

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (date: Date) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fold long lines at 75 octets, as the format requires. */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 74;
    while (Buffer.byteLength(rest.slice(0, cut)) > 74) cut -= 1;
    parts.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

/**
 * A calendar entry for the session. The same UID with a higher SEQUENCE
 * replaces the earlier entry in the learner's calendar, and METHOD:CANCEL removes it.
 */
export function sessionCalendar(input: {
  id: string; title: string; startsAt: Date; durationMinutes: number; meetUrl: string; description?: string;
  organiser: string; sequence: number; cancelled?: boolean; now?: Date;
}): string {
  const end = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RDC Learning//Live sessions//EN", "CALSCALE:GREGORIAN",
    `METHOD:${input.cancelled ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${input.id}@rdc-learning`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${stamp(input.now ?? new Date())}`,
    `DTSTART:${stamp(input.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeText(input.title)}`,
    `DESCRIPTION:${escapeText([input.description ?? "", `Join: ${input.meetUrl}`].filter(Boolean).join("\n"))}`,
    `LOCATION:${escapeText(input.meetUrl)}`,
    `URL:${input.meetUrl}`,
    `ORGANIZER:mailto:${input.organiser}`,
    `STATUS:${input.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

export type AttendanceStatus = "PRESENT" | "ABSENT";
/** Only the instructor's word counts. */
export const attendedSession = (status: string | null | undefined) => status === "PRESENT";
