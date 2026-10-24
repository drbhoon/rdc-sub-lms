import { describe, expect, it } from "vitest";
import { attendedSession, canJoin, parseMeetLink, sessionCalendar, sessionPhase } from "./ilt";

const at = (iso: string) => new Date(iso);
const session = { startsAt: at("2026-11-02T04:30:00Z"), durationMinutes: 60, cancelledAt: null };

describe("sessionPhase", () => {
  it("is upcoming until a quarter of an hour before", () => {
    expect(sessionPhase(session, at("2026-11-02T04:00:00Z"))).toBe("upcoming");
    expect(canJoin("upcoming")).toBe(false);
  });
  it("opens 15 minutes early, then is live while it runs and for an hour after the planned end", () => {
    expect(sessionPhase(session, at("2026-11-02T04:15:00Z"))).toBe("open");
    expect(sessionPhase(session, at("2026-11-02T04:45:00Z"))).toBe("live");
    expect(sessionPhase(session, at("2026-11-02T06:29:00Z"))).toBe("live");
    expect(sessionPhase(session, at("2026-11-02T06:31:00Z"))).toBe("ended");
    expect(canJoin("live")).toBe(true);
    expect(canJoin("ended")).toBe(false);
  });
  it("a cancelled session is cancelled whatever the time", () => {
    expect(sessionPhase({ ...session, cancelledAt: at("2026-10-30T00:00:00Z") }, at("2026-11-02T04:45:00Z"))).toBe("cancelled");
  });
});

describe("parseMeetLink", () => {
  it("accepts a Meet link and keeps its query", () => {
    expect(parseMeetLink("https://meet.google.com/abc-defg-hij")).toEqual({ ok: true, url: "https://meet.google.com/abc-defg-hij" });
    expect(parseMeetLink("  meet.google.com/abc-defg-hij?authuser=1 ")).toEqual({ ok: true, url: "https://meet.google.com/abc-defg-hij?authuser=1" });
  });
  it("accepts a calendar lookup link", () => {
    expect(parseMeetLink("https://meet.google.com/lookup/abc123_x").ok).toBe(true);
  });
  it("refuses other sites, other shapes and nothing", () => {
    expect(parseMeetLink("https://zoom.us/j/123456").ok).toBe(false);
    expect(parseMeetLink("https://meet.google.com/").ok).toBe(false);
    expect(parseMeetLink("https://meet.google.com/abc").ok).toBe(false);
    expect(parseMeetLink("https://evil.example/meet.google.com/abc-defg-hij").ok).toBe(false);
    expect(parseMeetLink("").ok).toBe(false);
  });
});

describe("sessionCalendar", () => {
  const base = {
    id: "s1", title: "Induction, day 1", startsAt: at("2026-11-02T04:30:00Z"), durationMinutes: 90,
    meetUrl: "https://meet.google.com/abc-defg-hij", organiser: "lms@example.com", sequence: 2, now: at("2026-10-24T00:00:00Z"),
  };
  it("writes a request that a calendar can read", () => {
    const ics = sessionCalendar(base);
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("DTSTART:20261102T043000Z");
    expect(ics).toContain("DTEND:20261102T060000Z");
    expect(ics).toContain("UID:s1@rdc-learning");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).toContain("SUMMARY:Induction\\, day 1");
    expect(ics.endsWith("\r\n")).toBe(true);
  });
  it("a cancellation reuses the entry's identity", () => {
    const ics = sessionCalendar({ ...base, cancelled: true, sequence: 3 });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("UID:s1@rdc-learning");
  });
  it("folds long lines", () => {
    const ics = sessionCalendar({ ...base, description: "x".repeat(300) });
    expect(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
  });
});

describe("attendance", () => {
  it("only an instructor's PRESENT counts", () => {
    expect(attendedSession("PRESENT")).toBe(true);
    expect(attendedSession("ABSENT")).toBe(false);
    expect(attendedSession(null)).toBe(false);
    expect(attendedSession("PENDING")).toBe(false);
  });
});
