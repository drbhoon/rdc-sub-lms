import { describe, expect, it } from "vitest";
import { afterAllowing, finalSitting, isResumable, secondsLeft, type FinalSittingInput } from "./final-sitting";

const at = (iso: string) => new Date(iso);
const base: FinalSittingInput = {
  now: at("2026-10-12T05:00:00Z"),
  schedule: { opensAt: at("2026-10-12T04:30:00Z"), closesAt: at("2026-10-12T07:30:00Z") },
  attemptsUsed: 0, attemptsAllowed: 1, hasResumable: false, adminOpened: false,
};

describe("finalSitting", () => {
  it("is closed to everyone until an admin schedules it", () => {
    expect(finalSitting({ ...base, schedule: null }).state).toBe("NOT_SCHEDULED");
  });

  it("opens at the scheduled time, not before", () => {
    expect(finalSitting({ ...base, now: at("2026-10-12T04:29:59Z") })).toEqual({ state: "SCHEDULED", opensAt: base.schedule!.opensAt });
    expect(finalSitting({ ...base, now: at("2026-10-12T04:30:00Z") }).state).toBe("OPEN");
  });

  it("stops new starts at the closing time, if there is one", () => {
    expect(finalSitting({ ...base, now: at("2026-10-12T07:30:00Z") }).state).toBe("CLOSED");
    expect(finalSitting({ ...base, now: at("2030-01-01T00:00:00Z"), schedule: { opensAt: base.schedule!.opensAt, closesAt: null } }).state).toBe("OPEN");
  });

  it("gives one attempt: once it is used the learner cannot sit it again", () => {
    expect(finalSitting({ ...base, attemptsUsed: 1 }).state).toBe("USED");
    expect(finalSitting({ ...base, attemptsUsed: 3, adminOpened: true }).state).toBe("USED");
  });

  it("lets a learner carry on an attempt already under way, even after the window closes", () => {
    expect(finalSitting({ ...base, attemptsUsed: 1, hasResumable: true, now: at("2026-10-12T09:00:00Z") }).state).toBe("RESUME");
  });

  it("lets an admin's permission override the schedule, before it opens or after it closes", () => {
    expect(finalSitting({ ...base, now: at("2026-10-12T04:00:00Z"), adminOpened: true }).state).toBe("OPEN");
    expect(finalSitting({ ...base, now: at("2026-10-13T00:00:00Z"), adminOpened: true }).state).toBe("OPEN");
    expect(finalSitting({ ...base, schedule: null, adminOpened: true }).state).toBe("OPEN");
  });
});

describe("afterAllowing", () => {
  it("gives a learner who has used their attempt exactly one more", () => {
    expect(afterAllowing({ attemptsUsed: 1, attemptsAllowed: 1 })).toEqual({ attemptsAllowed: 2, adminOpened: true });
  });

  it("does not hand a learner who has not sat it a spare: they keep their one", () => {
    expect(afterAllowing({ attemptsUsed: 0, attemptsAllowed: 1 })).toEqual({ attemptsAllowed: 1, adminOpened: true });
  });

  it("allows one more than were used, even for someone who had many before attempts were limited", () => {
    expect(afterAllowing({ attemptsUsed: 4, attemptsAllowed: 1 })).toEqual({ attemptsAllowed: 5, adminOpened: true });
  });

  it("never lowers what was already allowed", () => {
    expect(afterAllowing({ attemptsUsed: 1, attemptsAllowed: 3 }).attemptsAllowed).toBe(3);
  });
});

describe("resuming", () => {
  const started = at("2026-10-12T05:00:00Z");

  it("an attempt is resumable only inside its own time limit", () => {
    expect(isResumable({ status: "IN_PROGRESS", startedAt: started }, 2400, at("2026-10-12T05:39:59Z"))).toBe(true);
    expect(isResumable({ status: "IN_PROGRESS", startedAt: started }, 2400, at("2026-10-12T05:40:00Z"))).toBe(false);
    expect(isResumable({ status: "SUBMITTED", startedAt: started }, 2400, at("2026-10-12T05:01:00Z"))).toBe(false);
  });

  it("a resumed attempt keeps the clock it already had, never below zero", () => {
    expect(secondsLeft(started, 2400, at("2026-10-12T05:10:00Z"))).toBe(1800);
    expect(secondsLeft(started, 2400, at("2026-10-12T06:00:00Z"))).toBe(0);
  });
});
