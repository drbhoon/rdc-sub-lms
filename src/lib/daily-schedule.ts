/**
 * Once-a-day jobs run by the worker, at a time of day in India.
 *
 * Nothing inside LMS used to start the daily reminders: they waited for an
 * outside scheduler to call a URL, and the only scheduler anyone had set up
 * pointed at a test deployment, which is why reminders arrived from there
 * with its address in them while the real LMS sent none. The worker already
 * runs all day, so it is the natural place for the clock.
 *
 * Pure of timers and I/O, so the rules can be tested with a fake clock.
 */
const IST_OFFSET_MS = 330 * 60_000; // UTC+05:30 all year; India has no daylight saving.

export type TimeOfDay = { hour: number; minute: number };

/** "09:00" → 9:00. "off", blank or anything unreadable → null, meaning the job is switched off. */
export function parseTimeOfDay(value: string | undefined): TimeOfDay | null {
  const match = /^\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/.exec(value ?? "");
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

/**
 * When a job should start, from its setting.
 *
 * Unset means the default — except on a Railway test bed, where unset means
 * off. Railway holds no real data, and a test copy that quietly e-mails
 * people from its own address is exactly how reminders came to arrive with a
 * Railway link in them. Setting the variable there is how to opt in.
 */
export function scheduledTime(setting: string | undefined, fallback: string, onTestBed: boolean): TimeOfDay | null {
  if (setting === undefined) return onTestBed ? null : parseTimeOfDay(fallback);
  return parseTimeOfDay(setting);
}

/** The calendar date in India, "2026-10-03" — which is not always the UTC date. */
export function istDateKey(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function istMinuteOfDay(now: Date): number {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export type DailyJobOptions = {
  name: string;
  at: TimeOfDay;
  run: () => Promise<void>;
  /** A run that throws is tried again this many times in all, a day. */
  maxAttempts?: number;
  retryAfterMinutes?: number;
  /**
   * How long after `at` the job may still start. A worker restarted at 23:50
   * should not send the morning's reminders at midnight; one restarted at
   * 10:30 should still catch up on a 09:00 job.
   */
  windowMinutes?: number;
  log?: (message: string) => void;
};

/**
 * Call `tick(now)` every minute or so. It runs the job at most once per IST
 * day, starting it from the chosen time (so a late start catches up), retrying
 * a failure a few times, and never starting a second run while one is going.
 */
export function createDailyJob(options: DailyJobOptions) {
  const { name, at, run, maxAttempts = 3, retryAfterMinutes = 15, windowMinutes = 360, log = console.log } = options;
  const startMinute = at.hour * 60 + at.minute;
  let doneOn: string | null = null;
  let attemptsOn: string | null = null;
  let attempts = 0;
  let retryNotBefore = 0;
  let running = false;

  return {
    name,
    async tick(now: Date = new Date()): Promise<"ran" | "failed" | "idle"> {
      if (running) return "idle";
      const day = istDateKey(now);
      if (doneOn === day) return "idle";
      const minute = istMinuteOfDay(now);
      if (minute < startMinute || minute >= startMinute + windowMinutes) return "idle";
      if (attemptsOn !== day) { attemptsOn = day; attempts = 0; retryNotBefore = 0; }
      if (attempts >= maxAttempts || now.getTime() < retryNotBefore) return "idle";

      running = true;
      attempts += 1;
      try {
        log(`[schedule] ${name}: starting (attempt ${attempts})`);
        await run();
        doneOn = day;
        log(`[schedule] ${name}: done`);
        return "ran";
      } catch (error) {
        retryNotBefore = now.getTime() + retryAfterMinutes * 60_000;
        log(`[schedule] ${name}: failed - ${error instanceof Error ? error.message : String(error)}${attempts < maxAttempts ? `; trying again in ${retryAfterMinutes} minutes` : "; giving up until tomorrow"}`);
        return "failed";
      } finally {
        running = false;
      }
    },
  };
}
