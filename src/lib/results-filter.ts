import type { Prisma } from "@prisma/client";

/**
 * The three dropdowns above the Course results table: learner, classroom and
 * teacher. One place for what they mean, so the table on the page, the
 * dropdowns' own choices and the Excel download cannot disagree.
 *
 * "" means everyone; NONE means the learners who have no classroom (or whose
 * classroom has no teacher).
 */
export const NONE = "none";

export type ResultFilter = { learner: string; classroom: string; teacher: string };
export type FilterField = keyof ResultFilter;

export const noFilter: ResultFilter = { learner: "", classroom: "", teacher: "" };

export type FilterRow = { employeeId: string; classroomId: string | null; teacherUserId: string | null };

const valueOf = (row: FilterRow, field: FilterField) =>
  field === "learner" ? row.employeeId : field === "classroom" ? row.classroomId : row.teacherUserId;

/** Does this row satisfy ONE field of the filter? */
export function fieldMatches(row: FilterRow, field: FilterField, wanted: string): boolean {
  if (wanted === "") return true;
  const actual = valueOf(row, field);
  return wanted === NONE ? actual === null : actual === wanted;
}

const FIELDS: FilterField[] = ["classroom", "teacher", "learner"];

export function matchesFilter(row: FilterRow, filter: ResultFilter): boolean {
  return FIELDS.every((field) => fieldMatches(row, field, filter[field]));
}

/** Rows that satisfy every field EXCEPT `skip`: what that field's own dropdown may offer. */
export function rowsForChoices<T extends FilterRow>(rows: T[], filter: ResultFilter, skip: FilterField): T[] {
  return rows.filter((row) => FIELDS.every((field) => field === skip || fieldMatches(row, field, filter[field])));
}

/**
 * Drop any chosen value that the dropdown just changed has made impossible.
 * Pick a learner, then switch to a classroom they are not in: the learner
 * choice is cleared, not the classroom just chosen, rather than leaving a
 * table that is empty for no visible reason. `keep` is the dropdown the person
 * just used; it is never the one that gets cleared.
 */
export function reconcile(rows: FilterRow[], filter: ResultFilter, keep?: FilterField): ResultFilter {
  const next = { ...filter };
  for (let pass = 0; pass < 2; pass += 1) {
    for (const field of FIELDS) {
      if (!next[field] || field === keep) continue;
      const possible = rowsForChoices(rows, next, field).some((row) => fieldMatches(row, field, next[field]));
      if (!possible) next[field] = "";
    }
  }
  return next;
}

/** "?classroom=...&teacher=..." with only the fields that are set; "" when none are. */
export function resultFilterQuery(filter: ResultFilter): string {
  const params = new URLSearchParams();
  for (const field of FIELDS) if (filter[field]) params.set(field, filter[field]);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function resultFilterFromParams(params: URLSearchParams): ResultFilter {
  return {
    learner: params.get("learner") ?? "",
    classroom: params.get("classroom") ?? "",
    teacher: params.get("teacher") ?? "",
  };
}

/** The same filter as a database condition on enrolments, for the Excel download. */
export function resultFilterWhere(filter: ResultFilter): Prisma.EnrollmentWhereInput {
  const all: Prisma.EnrollmentWhereInput[] = [];
  if (filter.learner) all.push({ employeeId: filter.learner });
  if (filter.classroom) all.push(filter.classroom === NONE ? { classroomId: null } : { classroomId: filter.classroom });
  if (filter.teacher) {
    all.push(
      filter.teacher === NONE
        ? { OR: [{ classroomId: null }, { classroom: { teacherUserId: null } }] }
        : { classroom: { teacherUserId: filter.teacher } },
    );
  }
  return all.length ? { AND: all } : {};
}
