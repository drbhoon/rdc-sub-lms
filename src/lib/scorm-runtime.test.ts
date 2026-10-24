import { describe, expect, it } from "vitest";
import {
  commitSchema, formatScormClock, formatScormDuration, fromLessonStatus, nextLaunch, outcomeOf, parseScormTime, updateFromCommit,
  type AttemptState,
} from "./scorm-runtime";

const attempt = (number: number, extra: Partial<AttemptState> = {}): AttemptState => ({
  id: `a${number}`, attemptNumber: number, completionStatus: "incomplete", successStatus: "unknown",
  suspended: false, finished: false, resetAt: null, ...extra,
});

describe("outcomeOf", () => {
  it("trusts the package's own pass or fail", () => {
    expect(outcomeOf({ completionStatus: "completed", successStatus: "passed" })).toBe("passed");
    expect(outcomeOf({ completionStatus: "completed", successStatus: "failed" })).toBe("failed");
    expect(outcomeOf({ completionStatus: "incomplete", successStatus: "failed" })).toBe("failed");
  });
  it("counts completing as passing when the package does not test", () => {
    expect(outcomeOf({ completionStatus: "completed", successStatus: "unknown" })).toBe("passed");
  });
  it("is incomplete or not started otherwise", () => {
    expect(outcomeOf({ completionStatus: "incomplete", successStatus: "unknown" })).toBe("incomplete");
    expect(outcomeOf({ completionStatus: "not attempted", successStatus: "unknown" })).toBe("not started");
  });
});

describe("nextLaunch: two attempts", () => {
  it("starts the first attempt", () => {
    expect(nextLaunch([])).toEqual({ kind: "start", attemptNumber: 1 });
  });
  it("resumes an attempt that was left part-way, however it was left", () => {
    const left = attempt(1, { suspended: true });
    expect(nextLaunch([left])).toEqual({ kind: "resume", attempt: left });
    const abandoned = attempt(1);
    expect(nextLaunch([abandoned])).toEqual({ kind: "resume", attempt: abandoned });
  });
  it("offers a retry after a failed attempt", () => {
    expect(nextLaunch([attempt(1, { finished: true, completionStatus: "completed", successStatus: "failed" })])).toEqual({ kind: "retry", attemptNumber: 2 });
  });
  it("locks after the second attempt fails", () => {
    const failed = { finished: true, completionStatus: "completed", successStatus: "failed" };
    expect(nextLaunch([attempt(1, failed), attempt(2, failed)])).toEqual({ kind: "locked" });
  });
  it("an attempt that ended unfinished also uses up one of the two", () => {
    const ended = { finished: true, completionStatus: "incomplete" };
    expect(nextLaunch([attempt(1, ended), attempt(2, ended)])).toEqual({ kind: "locked" });
  });
  it("lets a learner who has passed review the course without a new attempt", () => {
    const passed = attempt(1, { finished: true, completionStatus: "completed", successStatus: "passed" });
    expect(nextLaunch([passed])).toEqual({ kind: "review", attempt: passed });
  });
  it("passing on the second attempt is a pass", () => {
    const failed = attempt(1, { finished: true, completionStatus: "completed", successStatus: "failed" });
    const passed = attempt(2, { finished: true, completionStatus: "completed", successStatus: "passed" });
    expect(nextLaunch([failed, passed]).kind).toBe("review");
  });
  it("an admin reset gives two new attempts, and old numbers are not reused", () => {
    const failed = { finished: true, completionStatus: "completed", successStatus: "failed" };
    const reset = new Date();
    const history = [attempt(1, { ...failed, resetAt: reset }), attempt(2, { ...failed, resetAt: reset })];
    expect(nextLaunch(history)).toEqual({ kind: "start", attemptNumber: 3 });
    const afterOne = [...history, attempt(3, failed)];
    expect(nextLaunch(afterOne)).toEqual({ kind: "retry", attemptNumber: 4 });
    expect(nextLaunch([...afterOne, attempt(4, failed)])).toEqual({ kind: "locked" });
  });
});

describe("commits", () => {
  it("accepts what a package really sends", () => {
    const parsed = commitSchema.parse({ completionStatus: "completed", successStatus: "passed", scoreRaw: 85, location: "5", suspendData: "abc", totalSeconds: 600, finish: true, exit: "" });
    expect(parsed.scoreRaw).toBe(85);
  });
  it("refuses made-up statuses and silly sizes", () => {
    expect(commitSchema.safeParse({ completionStatus: "done" }).success).toBe(false);
    expect(commitSchema.safeParse({ scoreRaw: Number.NaN }).success).toBe(false);
    expect(commitSchema.safeParse({ suspendData: "x".repeat(500_001) }).success).toBe(false);
  });
  it("writes only what was sent", () => {
    const data = updateFromCommit({ location: "7" });
    expect(Object.keys(data).sort()).toEqual(["lastCommitAt", "location"]);
  });
  it("a finish without suspend ends the attempt; with suspend it only pauses it", () => {
    expect(updateFromCommit({ finish: true, exit: "" })).toMatchObject({ finished: true, suspended: false });
    expect(updateFromCommit({ finish: true, exit: "suspend" })).toMatchObject({ finished: false, suspended: true });
  });
  it("a plain save does not end the attempt", () => {
    expect(updateFromCommit({ completionStatus: "incomplete" })).not.toHaveProperty("finished");
  });
});

describe("SCORM 1.2 status", () => {
  it("maps onto completion and success", () => {
    expect(fromLessonStatus("passed")).toEqual({ completionStatus: "completed", successStatus: "passed" });
    expect(fromLessonStatus("failed")).toEqual({ completionStatus: "completed", successStatus: "failed" });
    expect(fromLessonStatus("completed")).toEqual({ completionStatus: "completed", successStatus: "unknown" });
    expect(fromLessonStatus("incomplete")).toEqual({ completionStatus: "incomplete", successStatus: "unknown" });
    expect(fromLessonStatus("not attempted")).toEqual({ completionStatus: "not attempted", successStatus: "unknown" });
    expect(fromLessonStatus("PASSED ")).toEqual({ completionStatus: "completed", successStatus: "passed" });
  });
});

describe("SCORM time", () => {
  it("reads both formats", () => {
    expect(parseScormTime("0001:02:03.45")).toBe(3723);
    expect(parseScormTime("00:10:00")).toBe(600);
    expect(parseScormTime("PT1H2M3S")).toBe(3723);
    expect(parseScormTime("PT45S")).toBe(45);
    expect(parseScormTime("PT0.5S")).toBe(0);
    expect(parseScormTime("nonsense")).toBeNull();
    expect(parseScormTime("P")).toBeNull();
  });
  it("writes both formats", () => {
    expect(formatScormClock(3723)).toBe("0001:02:03.00");
    expect(formatScormDuration(3723)).toBe("PT1H2M3S");
  });
});
