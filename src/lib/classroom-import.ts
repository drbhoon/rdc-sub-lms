import type { CourseEnrollmentRow } from "./course-enrollment-import";
import { normalizeEmail } from "./security";
import type { ImportRow } from "./tabular-import";

/**
 * The classroom upload: one file that sets up a whole course's classrooms —
 * which rooms exist, who teaches each, and which learners sit in each.
 *
 * One row per learner. The classroom and its teacher are repeated on every
 * row of that room, so the file is an ordinary flat list a coordinator can
 * sort and filter. A row with a classroom but no learner is allowed: it
 * creates (or re-teachers) an empty room, for setting rooms up before the
 * learner list is final.
 */
export const CLASSROOM_COLUMNS = ["CLASSROOM", "TEACHER_EMAIL", "LEARNER_EMAIL", "LEARNER_NAME", "EMP_CODE", "COMPANY", "DESIGNATION"] as const;
export const CLASSROOM_NAME_MAX = 80;

const aliases: Record<string, string> = {
  CLASS: "CLASSROOM",
  CLASS_ROOM: "CLASSROOM",
  CLASSROOM_NAME: "CLASSROOM",
  CLASS_ROOM_NAME: "CLASSROOM",
  TEACHER: "TEACHER_EMAIL",
  TEACHER_E_MAIL: "TEACHER_EMAIL",
  TEACHER_EMAIL_ID: "TEACHER_EMAIL",
  EMAIL: "LEARNER_EMAIL",
  EMAIL_ID: "LEARNER_EMAIL",
  LEARNER_E_MAIL: "LEARNER_EMAIL",
  STUDENT_EMAIL: "LEARNER_EMAIL",
  NAME: "LEARNER_NAME",
  STUDENT_NAME: "LEARNER_NAME",
  EMPLOYEE_NAME: "LEARNER_NAME",
  EMPLOYEE_CODE: "EMP_CODE",
  EMPCODE: "EMP_CODE",
  CODE: "EMP_CODE",
};

function canonicalHeader(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  return aliases[normalized] ?? normalized;
}

/** "  Class   Room 7 " -> "Class Room 7" — how a room name is stored and shown. */
export function tidyClassroomName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

/** Room names match case-insensitively: "class room 7" in row 40 is "Class Room 7" from row 2. */
export function classroomKey(value: string) {
  return tidyClassroomName(value).toLowerCase();
}

export type PlannedClassroom = {
  /** As first spelled in the file. */
  name: string;
  /** Null when no row of this room names a teacher — an existing room's teacher is then left as it is. */
  teacherEmail: string | null;
  learnerEmails: string[];
};

export type ClassroomPlan = {
  classrooms: PlannedClassroom[];
  /** One entry per learner e-mail, in the shape the roster enrolment takes. */
  learners: CourseEnrollmentRow[];
  /** Every problem in the file. Any error means nothing is written. */
  errors: string[];
};

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function hasClassroomColumns(row: ImportRow) {
  const headings = new Set(Object.keys(row).map(canonicalHeader));
  return headings.has("CLASSROOM") && headings.has("LEARNER_EMAIL");
}

/**
 * Read and check the whole file before anything is written.
 *
 * All-or-nothing on purpose. A half-applied classroom file — 49 rooms made,
 * the 50th rejected, its ten learners left unassigned — is worse than a clear
 * list of what to fix, because nobody can tell from the course page which
 * half happened. So every row is checked and every problem reported at once.
 */
export function planClassrooms(rawRows: ImportRow[]): ClassroomPlan {
  const errors: string[] = [];
  type Room = { name: string; teachers: Map<string, number>; learnerEmails: string[] };
  const rooms = new Map<string, Room>();
  const roomOfLearner = new Map<string, { key: string; row: number }>();
  const learners = new Map<string, CourseEnrollmentRow>();

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2; // row 1 is the heading
    const values = Object.fromEntries(Object.entries(raw).map(([key, value]) => [canonicalHeader(key), String(value ?? "").trim()]));
    const name = tidyClassroomName(values.CLASSROOM ?? "");
    const teacherEmail = normalizeEmail(values.TEACHER_EMAIL ?? "");
    const learnerEmail = normalizeEmail(values.LEARNER_EMAIL ?? "");

    if (!name) {
      if (learnerEmail || teacherEmail) errors.push(`Row ${rowNumber}: CLASSROOM is blank.`);
      return;
    }
    if (name.length > CLASSROOM_NAME_MAX) {
      errors.push(`Row ${rowNumber}: classroom name is longer than ${CLASSROOM_NAME_MAX} characters.`);
      return;
    }
    if (teacherEmail && !looksLikeEmail(teacherEmail)) errors.push(`Row ${rowNumber}: TEACHER_EMAIL "${teacherEmail}" is not an e-mail address.`);
    if (learnerEmail && !looksLikeEmail(learnerEmail)) {
      errors.push(`Row ${rowNumber}: LEARNER_EMAIL "${learnerEmail}" is not an e-mail address.`);
      return;
    }

    const key = classroomKey(name);
    const room: Room = rooms.get(key) ?? { name, teachers: new Map(), learnerEmails: [] };
    rooms.set(key, room);
    if (teacherEmail && looksLikeEmail(teacherEmail) && !room.teachers.has(teacherEmail)) room.teachers.set(teacherEmail, rowNumber);

    if (!learnerEmail) return;
    const earlier = roomOfLearner.get(learnerEmail);
    if (earlier) {
      if (earlier.key !== key) {
        errors.push(`Row ${rowNumber}: ${learnerEmail} is already placed in "${rooms.get(earlier.key)!.name}" on row ${earlier.row}. A learner can sit in only one classroom.`);
      }
      return; // the same person listed twice in the same room is harmless
    }
    roomOfLearner.set(learnerEmail, { key, row: rowNumber });
    room.learnerEmails.push(learnerEmail);
    learners.set(learnerEmail, {
      email: learnerEmail,
      name: values.LEARNER_NAME ?? "",
      employeeCode: values.EMP_CODE ?? "",
      company: values.COMPANY ?? "",
      designation: values.DESIGNATION ?? "",
    });
  });

  for (const room of rooms.values()) {
    if (room.teachers.size > 1) {
      const listed = [...room.teachers.entries()].map(([email, row]) => `${email} (row ${row})`).join(", ");
      errors.push(`"${room.name}" names more than one teacher: ${listed}. A classroom has one teacher.`);
    }
  }
  if (!rooms.size && !errors.length) errors.push("No row names a classroom.");

  return {
    classrooms: [...rooms.values()].map((room) => ({
      name: room.name,
      teacherEmail: room.teachers.size === 1 ? [...room.teachers.keys()][0] : null,
      learnerEmails: room.learnerEmails,
    })),
    learners: [...learners.values()],
    errors,
  };
}
