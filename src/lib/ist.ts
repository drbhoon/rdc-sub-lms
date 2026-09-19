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
