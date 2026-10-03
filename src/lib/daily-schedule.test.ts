import { describe, expect, it } from "vitest";
import { createDailyJob, istDateKey, parseTimeOfDay, scheduledTime } from "./daily-schedule";

// 2026-10-03 at the given IST wall-clock time, as a UTC instant.
const ist = (time: string, date = "2026-10-03") => new Date(new Date(`${date}T${time}:00Z`).getTime() - 330 * 60_000);

describe("parseTimeOfDay", () => {
  it("reads HH:MM and treats off, blank and nonsense as switched off", () => {
    expect(parseTimeOfDay("09:00")).toEqual({ hour: 9, minute: 0 });
    expect(parseTimeOfDay(" 4:05 ")).toEqual({ hour: 4, minute: 5 });
    expect(parseTimeOfDay("23:59")).toEqual({ hour: 23, minute: 59 });
    for (const bad of ["off", "", undefined, "24:00", "9", "09:60", "nine"]) expect(parseTimeOfDay(bad)).toBeNull();
  });
});

describe("scheduledTime", () => {
  it("uses the default when unset, but stays off on a test bed unless asked", () => {
    expect(scheduledTime(undefined, "09:00", false)).toEqual({ hour: 9, minute: 0 });
    expect(scheduledTime(undefined, "09:00", true)).toBeNull();
    expect(scheduledTime("06:30", "09:00", true)).toEqual({ hour: 6, minute: 30 });
    expect(scheduledTime("off", "09:00", false)).toBeNull();
  });
});

describe("istDateKey", () => {
  it("is the date in India, not in UTC", () => {
    expect(istDateKey(new Date("2026-10-02T18:30:00Z"))).toBe("2026-10-03"); // 00:00 IST
    expect(istDateKey(new Date("2026-10-03T18:29:00Z"))).toBe("2026-10-03"); // 23:59 IST
  });
});

describe("createDailyJob", () => {
  function make(overrides: { run?: () => Promise<void>; windowMinutes?: number } = {}) {
    const calls: string[] = [];
    const job = createDailyJob({
      name: "test", at: { hour: 9, minute: 0 }, log: () => undefined,
      run: overrides.run ?? (async () => { calls.push("run"); }),
      windowMinutes: overrides.windowMinutes,
    });
    return { job, calls };
  }

  it("waits for its time, runs once, and not again the same day", async () => {
    const { job, calls } = make();
    expect(await job.tick(ist("08:59"))).toBe("idle");
    expect(await job.tick(ist("09:00"))).toBe("ran");
    expect(await job.tick(ist("09:01"))).toBe("idle");
    expect(await job.tick(ist("15:00"))).toBe("idle");
    expect(calls).toHaveLength(1);
  });

  it("runs again the next day", async () => {
    const { job, calls } = make();
    await job.tick(ist("09:00"));
    expect(await job.tick(ist("09:00", "2026-10-04"))).toBe("ran");
    expect(calls).toHaveLength(2);
  });

  it("catches up after a late start, but not after the window has closed", async () => {
    expect(await make().job.tick(ist("10:30"))).toBe("ran");
    expect(await make().job.tick(ist("23:50"))).toBe("idle");
  });

  it("retries a failure after the pause, a limited number of times", async () => {
    let attempt = 0;
    const { job } = make({ run: async () => { attempt += 1; throw new Error("master down"); } });
    expect(await job.tick(ist("09:00"))).toBe("failed");
    expect(await job.tick(ist("09:05"))).toBe("idle"); // too soon
    expect(await job.tick(ist("09:15"))).toBe("failed");
    expect(await job.tick(ist("09:30"))).toBe("failed");
    expect(await job.tick(ist("09:45"))).toBe("idle"); // three attempts used
    expect(attempt).toBe(3);
    await job.tick(ist("09:00", "2026-10-04"));
    expect(attempt).toBe(4); // tomorrow starts fresh
  });

  it("does not start a second run while one is still going", async () => {
    let release = () => {};
    let started = 0;
    const { job } = make({ run: () => new Promise<void>((resolve) => { started += 1; release = resolve; }) });
    const first = job.tick(ist("09:00"));
    expect(await job.tick(ist("09:01"))).toBe("idle");
    release();
    await first;
    expect(started).toBe(1);
  });
});
