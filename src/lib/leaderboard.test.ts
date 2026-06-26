import { describe, expect, it } from "vitest";
import { buildLeaderboardRows } from "./leaderboard";

describe("buildLeaderboardRows", () => {
  it("uses 70 percent progress score and 30 percent normalized speed score", () => {
    const base = new Date("2026-06-01T00:00:00.000Z");
    const rows = buildLeaderboardRows([
      {
        enrollmentId: "1",
        courseId: "course",
        courseTitle: "Safety",
        employeeCode: "A",
        employeeName: "Fast Learner",
        companyName: "RDC",
        enrolledAt: base,
        startedAt: base,
        completedAt: new Date(base.getTime() + 60 * 60 * 1000),
        totalLessons: 10,
        completedLessons: 10,
      },
      {
        enrollmentId: "2",
        courseId: "course",
        courseTitle: "Safety",
        employeeCode: "B",
        employeeName: "Slow Learner",
        companyName: "RDC",
        enrolledAt: base,
        startedAt: base,
        completedAt: new Date(base.getTime() + 2 * 60 * 60 * 1000),
        totalLessons: 10,
        completedLessons: 10,
      },
    ]);

    expect(rows[0].employeeName).toBe("Fast Learner");
    expect(rows[0].rankScore).toBe(100);
    expect(rows[1].rankScore).toBe(70);
  });

  it("keeps incomplete learners below completed learners", () => {
    const base = new Date("2026-06-01T00:00:00.000Z");
    const rows = buildLeaderboardRows([
      {
        enrollmentId: "1",
        courseId: "course",
        courseTitle: "Safety",
        employeeCode: "A",
        employeeName: "Complete",
        companyName: "RDC",
        enrolledAt: base,
        startedAt: base,
        completedAt: new Date(base.getTime() + 60 * 60 * 1000),
        totalLessons: 10,
        completedLessons: 10,
      },
      {
        enrollmentId: "2",
        courseId: "course",
        courseTitle: "Safety",
        employeeCode: "B",
        employeeName: "Partial",
        companyName: "RDC",
        enrolledAt: base,
        startedAt: base,
        completedAt: null,
        totalLessons: 10,
        completedLessons: 8,
      },
    ]);

    expect(rows[0].employeeName).toBe("Complete");
    expect(rows[1].rankScore).toBe(56);
  });
});
