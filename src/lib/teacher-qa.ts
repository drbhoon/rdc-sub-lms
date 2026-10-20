import type { UserRole } from "@prisma/client";
import { classroomScope, enrollmentScopeWhere } from "@/lib/classroom-scope";
import { db } from "@/lib/db";
import { formatIst } from "@/lib/ist";

/**
 * Learners' questions to their teacher (not the AI assistant), for the Q&A
 * history on the course pages and its Excel download.
 *
 * Seen the way the teacher page already shows them: a teacher who runs
 * classrooms on the course sees only their own learners' questions, a teacher
 * who runs none and an admin see everyone's. One function decides that, so the
 * picker, the list and the Excel cannot disagree.
 */
type Viewer = { id: string; roles: { role: UserRole }[] };

export async function teacherQaWhere(courseId: string, viewer: Viewer) {
  const owned = await db.classroom.findMany({ where: { courseId, teacherUserId: viewer.id }, select: { id: true } });
  const scope = classroomScope({ roles: viewer.roles.map((grant) => grant.role), ownedClassroomIds: owned.map((room) => room.id) });
  return { courseId, employee: { enrollments: { some: { courseId, ...enrollmentScopeWhere(scope) } } } };
}

export type TeacherQaLearner = { employeeId: string; name: string; employeeCode: string; count: number; unanswered: number };

export type TeacherQaItem = {
  id: string;
  question: string;
  /** The teacher's reply, or null while it waits. */
  answer: string | null;
  asked: string;
  answered: string | null;
};

/** Learners who have asked their teacher something in this course, most recently active first. */
export async function loadTeacherQaLearners(courseId: string, viewer: Viewer): Promise<TeacherQaLearner[]> {
  const where = await teacherQaWhere(courseId, viewer);
  const [groups, waiting] = await Promise.all([
    db.courseQuestion.groupBy({ by: ["employeeId"], where, _count: { _all: true }, _max: { createdAt: true } }),
    db.courseQuestion.groupBy({ by: ["employeeId"], where: { ...where, answer: null }, _count: { _all: true } }),
  ]);
  if (!groups.length) return [];
  const unanswered = new Map(waiting.map((group) => [group.employeeId, group._count._all]));
  const employees = await db.employee.findMany({
    where: { id: { in: groups.map((group) => group.employeeId) } },
    select: { id: true, name: true, employeeCode: true },
  });
  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  return groups
    .flatMap((group) => {
      const employee = byId.get(group.employeeId);
      return employee ? [{
        latest: group._max.createdAt?.getTime() ?? 0,
        learner: { employeeId: employee.id, name: employee.name, employeeCode: employee.employeeCode, count: group._count._all, unanswered: unanswered.get(group.employeeId) ?? 0 },
      }] : [];
    })
    .sort((a, b) => b.latest - a.latest)
    .map((row) => row.learner);
}

/** One learner's questions to their teacher, newest first. */
export async function loadTeacherQaFor(courseId: string, employeeId: string, viewer: Viewer): Promise<{ items: TeacherQaItem[]; total: number }> {
  const where = { ...(await teacherQaWhere(courseId, viewer)), employeeId };
  const rows = await db.courseQuestion.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
  return {
    total: rows.length,
    items: rows.map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      asked: formatIst(row.createdAt),
      answered: row.answeredAt ? formatIst(row.answeredAt) : null,
    })),
  };
}
