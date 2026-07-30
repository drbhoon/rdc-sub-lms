import { describe, expect, it } from "vitest";
import { REMINDER_DELAY_HOURS, reminderEnrollmentCutoff } from "./course-reminders";

describe("course reminder delay", () => {
  it("starts reminders only after 28 elapsed hours", () => {
    const now = new Date("2026-07-30T04:00:00.000Z");
    expect(REMINDER_DELAY_HOURS).toBe(28);
    expect(reminderEnrollmentCutoff(now).toISOString()).toBe("2026-07-29T00:00:00.000Z");
  });
});
