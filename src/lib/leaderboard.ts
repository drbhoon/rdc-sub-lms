export type LeaderboardInput = {
  enrollmentId: string;
  courseId: string;
  courseTitle: string;
  employeeCode: string;
  employeeName: string;
  companyName: string;
  enrolledAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  totalLessons: number;
  completedLessons: number;
  assessmentScorePercent?: number | null;
  completionSecondsOverride?: number | null;
};

export type LeaderboardRow = LeaderboardInput & {
  progressScore: number;
  speedScore: number;
  rankScore: number;
  completionSeconds: number | null;
};

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function completionSeconds(row: LeaderboardInput) {
  if (row.completionSecondsOverride !== undefined) return row.completionSecondsOverride;
  if (!row.completedAt) return null;
  const start = row.startedAt ?? row.enrolledAt;
  return Math.max(1, Math.floor((row.completedAt.getTime() - start.getTime()) / 1000));
}

export function buildLeaderboardRows(rows: LeaderboardInput[], limit = 10): LeaderboardRow[] {
  const byCourse = new Map<string, number[]>();
  for (const row of rows) {
    const seconds = completionSeconds(row);
    if (seconds !== null) byCourse.set(row.courseId, [...(byCourse.get(row.courseId) ?? []), seconds]);
  }

  return rows
    .filter((row) => row.completedLessons > 0 || Boolean(row.completedAt))
    .map((row) => {
      const completedSeconds = completionSeconds(row);
      const courseSeconds = byCourse.get(row.courseId) ?? [];
      const min = Math.min(...courseSeconds);
      const max = Math.max(...courseSeconds);
      const progressScore = row.assessmentScorePercent ?? (row.totalLessons > 0 ? Math.min(100, Math.max(0, row.completedLessons / row.totalLessons * 100)) : 0);
      let speedScore = 0;
      if (completedSeconds !== null && courseSeconds.length === 1) speedScore = 100;
      else if (completedSeconds !== null && Number.isFinite(min) && Number.isFinite(max) && max > min) speedScore = 100 - ((completedSeconds - min) / (max - min)) * 100;
      return {
        ...row,
        progressScore: round(progressScore),
        speedScore: round(Math.max(0, Math.min(100, speedScore))),
        rankScore: round(progressScore * 0.7 + Math.max(0, Math.min(100, speedScore)) * 0.3),
        completionSeconds: completedSeconds,
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore || b.progressScore - a.progressScore || a.employeeName.localeCompare(b.employeeName))
    .slice(0, limit);
}

export function formatDuration(seconds: number | null) {
  if (seconds === null) return "Not completed";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}
