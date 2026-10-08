/**
 * Every time a person reads in LMS is India Standard Time.
 *
 * The server runs in UTC (the Docker image sets no zone), so a bare
 * `toLocaleString("en-IN")` printed UTC with Indian formatting — 09:30 IST
 * came out as 4:00 am. Formatting names the zone explicitly instead, so the
 * result no longer depends on where the process happens to run.
 */
export const IST_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60_000; // UTC+05:30 all year; India has no daylight saving.

const dateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TIME_ZONE,
  day: "2-digit", month: "short", year: "numeric",
  hour: "numeric", minute: "2-digit", hour12: true,
});
const dateOnly = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TIME_ZONE,
  day: "2-digit", month: "short", year: "numeric",
});

/** "18 Sept 2026, 9:30 am IST" */
export function formatIst(date: Date | null | undefined): string {
  return date ? `${dateTime.format(date)} IST` : "";
}

/** "18 Sept 2026" — the calendar date in India, which is not always the UTC date. */
export function formatIstDate(date: Date | null | undefined): string {
  return date ? dateOnly.format(date) : "";
}

/**
 * The same instant, relabelled so its UTC fields read as IST wall-clock time.
 *
 * Excel has no time zones: a cell holds a bare date-time, and ExcelJS writes a
 * JS Date's UTC fields into it. Shifting by +05:30 immediately before writing
 * makes the sheet show the Indian time. Use only at that boundary — the result
 * is the wrong instant for anything else.
 */
export function toExcelIst(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

/**
 * What an admin types into a date-time box ("2026-10-12T10:00") is India time,
 * whatever zone the server or the browser happens to be in. The server runs in
 * UTC, so `new Date("2026-10-12T10:00")` would silently read it as UTC and
 * schedule everything five and a half hours late.
 */
export function parseIstLocal(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec((value ?? "").trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MS);
  // Reject a date that does not exist (31 Feb would roll into March).
  const back = new Date(date.getTime() + IST_OFFSET_MS);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return date;
}

/** The value for a date-time box, in India time: "2026-10-12T10:00". */
export function toIstLocalInput(date: Date | null | undefined): string {
  return date ? new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16) : "";
}
