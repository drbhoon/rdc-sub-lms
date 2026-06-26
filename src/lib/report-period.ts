export type PeriodKey = "today" | "yesterday" | "week" | "month" | "year" | "custom";

export type ReportPeriod = {
  key: PeriodKey;
  label: string;
  start: Date;
  end: Date;
  fromInput: string;
  toInput: string;
};

const IST_OFFSET_MINUTES = 330;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toInputDate(date: Date) {
  const local = new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

function fromInputDate(value: string, endOfDay = false) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const utc = Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return new Date(utc - IST_OFFSET_MINUTES * 60 * 1000);
}

function startOfIstDay(now: Date) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_OFFSET_MINUTES * 60 * 1000);
}

function startOfIstMonth(now: Date) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - IST_OFFSET_MINUTES * 60 * 1000);
}

function startOfIstYear(now: Date) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), 0, 1) - IST_OFFSET_MINUTES * 60 * 1000);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function endOfRange(start: Date, days: number) {
  return new Date(start.getTime() + days * DAY_MS - 1);
}

function getString(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function getReportPeriod(params: Record<string, string | string[] | undefined>, now = new Date()): ReportPeriod {
  const requested = getString(params, "period") as PeriodKey | undefined;
  const key: PeriodKey = requested && ["today", "yesterday", "week", "month", "year", "custom"].includes(requested) ? requested : "month";
  const todayStart = startOfIstDay(now);

  if (key === "custom") {
    const from = getString(params, "from");
    const to = getString(params, "to");
    const start = from ? fromInputDate(from) : null;
    const end = to ? fromInputDate(to, true) : null;
    if (from && to && start && end && start <= end) {
      return { key, label: `${from} to ${to}`, start, end, fromInput: from, toInput: to };
    }
  }

  if (key === "today") {
    const end = endOfRange(todayStart, 1);
    return { key, label: "Today", start: todayStart, end, fromInput: toInputDate(todayStart), toInput: toInputDate(end) };
  }

  if (key === "yesterday") {
    const start = addDays(todayStart, -1);
    const end = endOfRange(start, 1);
    return { key, label: "Yesterday", start, end, fromInput: toInputDate(start), toInput: toInputDate(end) };
  }

  if (key === "week") {
    const start = addDays(todayStart, -6);
    const end = endOfRange(todayStart, 1);
    return { key, label: "Last 7 days", start, end, fromInput: toInputDate(start), toInput: toInputDate(end) };
  }

  if (key === "year") {
    const start = startOfIstYear(now);
    const end = endOfRange(todayStart, 1);
    return { key, label: "This year", start, end, fromInput: toInputDate(start), toInput: toInputDate(end) };
  }

  const start = startOfIstMonth(now);
  const end = endOfRange(todayStart, 1);
  return { key: "month", label: "This month", start, end, fromInput: toInputDate(start), toInput: toInputDate(end) };
}

export function dateRangeWhere(period: ReportPeriod) {
  return { gte: period.start, lte: period.end };
}
