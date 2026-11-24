import { describe, expect, it } from "vitest";
import { certificateBlockers, type CertificateFacts } from "./certificate-blockers";

const done = new Date("2026-11-01T10:00:00Z");
const base: CertificateFacts = { enrolled: true, courseStatus: "PUBLISHED", completedAt: done, completedLessons: 3, totalLessons: 3, missing: [] };

describe("certificateBlockers", () => {
  it("says so when the learner is not on the course", () => {
    expect(certificateBlockers({ ...base, enrolled: false })).toEqual(["This learner is not enrolled in this course."]);
  });

  it("names an unpublished course", () => {
    const [reason] = certificateBlockers({ ...base, courseStatus: "PENDING_TEACHER_APPROVAL" });
    expect(reason).toMatch(/not published.*pending teacher approval/);
  });

  it("says a learner is not marked complete, with the lessons done, and does not repeat the lesson rule", () => {
    const reasons = certificateBlockers({ ...base, completedAt: null, completedLessons: 2, missing: ["Complete all lessons."] });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/not recorded as completed.*2 of 3 lessons/);
  });

  it("explains lessons published after the learner finished", () => {
    const reasons = certificateBlockers({ ...base, completedLessons: 3, totalLessons: 4, missing: ["Complete all lessons."] });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/3 of 4 lessons.*published after the learner finished/);
  });

  it("passes the other missing conditions through as they are, several at once", () => {
    const reasons = certificateBlockers({ ...base, missing: ["Submit course feedback.", "Pass mark not reached: Final quiz 52% (needs 60%)."] });
    expect(reasons).toEqual(["Submit course feedback.", "Pass mark not reached: Final quiz 52% (needs 60%)."]);
  });

  it("combines an unpublished course with what else is outstanding", () => {
    const reasons = certificateBlockers({ ...base, courseStatus: "DRAFT", missing: ["Certificate is disabled for this course."] });
    expect(reasons).toHaveLength(2);
    expect(reasons[1]).toBe("Certificate is disabled for this course.");
  });

  it("never returns an empty list", () => {
    expect(certificateBlockers(base)).toEqual(["The conditions for a certificate are not met."]);
  });
});
