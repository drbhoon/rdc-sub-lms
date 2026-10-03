import { db } from "@/lib/db";
import { formatIst } from "@/lib/ist";

/** Newest first; a learner who has asked more than this is told so, and the Excel holds the rest. */
export const AI_HISTORY_PAGE = 100;

export type AiHistoryLearner = { employeeId: string; name: string; employeeCode: string; company: string; count: number };

export type AiHistoryItem = {
  id: string;
  channel: string;
  language: string | null;
  question: string;
  /** The answer, or why there is none. */
  answer: string;
  asked: string;
};

/**
 * The learners who have used the AI assistant in this course, most recently
 * active first. The history used to be one table of the latest 25 questions
 * from everybody, which ran for screens and still hid most of a busy course;
 * a picker needs only who is in it and how much each has asked.
 */
export async function loadAiHistoryLearners(courseId: string): Promise<AiHistoryLearner[]> {
  const groups = await db.courseAiInteraction.groupBy({
    by: ["employeeId"],
    where: { courseId },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  if (!groups.length) return [];
  const employees = await db.employee.findMany({
    where: { id: { in: groups.map((group) => group.employeeId) } },
    select: { id: true, name: true, employeeCode: true, company: { select: { name: true } } },
  });
  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  return groups
    .flatMap((group) => {
      const employee = byId.get(group.employeeId);
      return employee ? [{ latest: group._max.createdAt?.getTime() ?? 0, learner: { employeeId: employee.id, name: employee.name, employeeCode: employee.employeeCode, company: employee.company.name, count: group._count._all } }] : [];
    })
    .sort((a, b) => b.latest - a.latest)
    .map((row) => row.learner);
}

/** One learner's questions in a course, newest first. */
export async function loadAiHistoryFor(courseId: string, employeeId: string): Promise<{ items: AiHistoryItem[]; total: number }> {
  const where = { courseId, employeeId };
  const [rows, total] = await Promise.all([
    db.courseAiInteraction.findMany({ where, orderBy: { createdAt: "desc" }, take: AI_HISTORY_PAGE }),
    db.courseAiInteraction.count({ where }),
  ]);
  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      language: row.language,
      question: row.question,
      answer: row.answer ?? row.error ?? row.status,
      asked: formatIst(row.createdAt),
    })),
  };
}
