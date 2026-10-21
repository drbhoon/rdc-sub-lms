import { EmployeeStatus, EnrollmentStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { learnersOnly } from "@/lib/teacher-preview";

/**
 * The Custom report: one row per learner-on-a-course, with whichever columns
 * the admin ticks, narrowed by whichever filters they set.
 *
 * Every column and every filter is declared once here. The page draws its
 * dropdowns from these lists, the preview and the Excel download read the same
 * rows, and the query string they share is parsed in one place, so what is
 * shown on screen cannot differ from what is downloaded.
 */

/** Stands for "has no value" in a filter (no plant recorded, no classroom, no teacher). */
export const BLANK = "__blank__";

/** Most rows one report returns. Beyond this the Excel says so rather than quietly stopping. */
export const MAX_REPORT_ROWS = 50_000;

export type Cell = string | number | Date | null;

export type ReportRow = Prisma.EnrollmentGetPayload<{ include: ReturnType<typeof rowInclude> }> & { totalLessons: number };

function rowInclude() {
  return {
    employee: { include: { company: true } },
    course: true,
    classroom: { include: { teacher: { include: { employee: true } } } },
    progress: { where: { completedAt: { not: null } }, select: { id: true } },
    assessmentAttempts: { where: { status: "SUBMITTED" as const }, select: { scorePercent: true, passed: true, submittedAt: true } },
  } satisfies Prisma.EnrollmentInclude;
}

export type ColumnGroup = "Learner" | "Course" | "Progress" | "Assessment";

export type Column = {
  key: string;
  label: string;
  group: ColumnGroup;
  /**
   * Basic details that are in EVERY report, whatever else is ticked: who the
   * learner is, which course, which classroom, who teaches it, and where they
   * stand. A report that sometimes lacked the classroom or the teacher could not
   * be read on its own, so these are not a choice.
   */
  core?: boolean;
  value: (row: ReportRow) => Cell;
};

const latestAttempt = (row: ReportRow) =>
  [...row.assessmentAttempts].sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0))[0];

export const COLUMNS: Column[] = [
  { key: "code", label: "Employee Code", group: "Learner", core: true, value: (r) => r.employee.employeeCode },
  { key: "name", label: "Name", group: "Learner", core: true, value: (r) => r.employee.name },
  { key: "email", label: "Email", group: "Learner", core: true, value: (r) => r.employee.email },
  { key: "mobile", label: "Mobile", group: "Learner", value: (r) => r.employee.mobileNumber ?? "" },
  { key: "company", label: "Company", group: "Learner", core: true, value: (r) => r.employee.company.name },
  { key: "location", label: "Location / Plant", group: "Learner", core: true, value: (r) => r.employee.locationPlant ?? "" },
  { key: "department", label: "Department", group: "Learner", value: (r) => r.employee.department },
  { key: "designation", label: "Designation", group: "Learner", core: true, value: (r) => r.employee.designation },
  { key: "manager", label: "Reporting Manager", group: "Learner", value: (r) => r.employee.managerName ?? "" },
  { key: "employeeStatus", label: "Employee Status", group: "Learner", value: (r) => r.employee.status },

  { key: "course", label: "Course", group: "Course", core: true, value: (r) => r.course.title },
  { key: "category", label: "Course Category", group: "Course", value: (r) => r.course.category },
  { key: "classroom", label: "Classroom", group: "Course", core: true, value: (r) => r.classroom?.name ?? "" },
  { key: "teacher", label: "Teacher", group: "Course", core: true, value: (r) => r.classroom?.teacher?.employee?.name ?? r.classroom?.teacher?.email ?? "" },
  { key: "teacherCode", label: "Teacher Employee Code", group: "Course", value: (r) => r.classroom?.teacher?.employee?.employeeCode ?? "" },

  { key: "enrolledOn", label: "Enrolled On", group: "Progress", core: true, value: (r) => r.enrolledAt },
  { key: "enrolStatus", label: "Course Status", group: "Progress", core: true, value: (r) => r.status.replaceAll("_", " ") },
  { key: "startedAt", label: "Started On", group: "Progress", value: (r) => r.startedAt },
  { key: "completedAt", label: "Completed On", group: "Progress", value: (r) => r.completedAt },
  { key: "lessonsDone", label: "Lessons Completed", group: "Progress", value: (r) => r.progress.length },
  { key: "lessonsTotal", label: "Total Lessons", group: "Progress", value: (r) => r.totalLessons },
  { key: "progressPct", label: "Progress %", group: "Progress", value: (r) => (r.totalLessons ? Math.round((r.progress.length / r.totalLessons) * 1000) / 10 : 0) },

  { key: "attempts", label: "Assessment Attempts", group: "Assessment", value: (r) => r.assessmentAttempts.length },
  { key: "latestScore", label: "Latest Score %", group: "Assessment", value: (r) => latestAttempt(r)?.scorePercent ?? "" },
  { key: "bestScore", label: "Best Score %", group: "Assessment", value: (r) => (r.assessmentAttempts.length ? Math.max(...r.assessmentAttempts.map((a) => a.scorePercent)) : "") },
  { key: "latestPassed", label: "Latest Result", group: "Assessment", value: (r) => { const a = latestAttempt(r); return a ? (a.passed ? "Passed" : "Not passed") : ""; } },
  { key: "latestSubmitted", label: "Last Assessment On", group: "Assessment", value: (r) => latestAttempt(r)?.submittedAt ?? null },
];

export const CORE_COLUMN_KEYS = COLUMNS.filter((column) => column.core).map((column) => column.key);

export type FilterKey = "company" | "location" | "department" | "designation" | "employeeStatus" | "course" | "classroom" | "teacher" | "enrolStatus";

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "location", label: "Location / Plant" },
  { key: "department", label: "Department" },
  { key: "designation", label: "Designation" },
  { key: "employeeStatus", label: "Employee Status" },
  { key: "course", label: "Course" },
  { key: "classroom", label: "Classroom" },
  { key: "teacher", label: "Teacher" },
  { key: "enrolStatus", label: "Course Status" },
];

export type CustomReportQuery = {
  /** Every column the report shows: the core ones always, then whichever extras were ticked, in the usual order. */
  columns: string[];
  /** Only the extra columns that were ticked (the core ones are not a choice). */
  extras: string[];
  filters: Record<FilterKey, string[]>;
  /** yyyy-mm-dd, IST; "" for no limit. Applies to the date the learner was enrolled. */
  from: string;
  to: string;
};

const FILTER_PARAM = (key: FilterKey) => `f_${key}`;

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function all(params: Params, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key).filter(Boolean);
  const value = params[key];
  return (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter(Boolean);
}

const one = (params: Params, key: string) => all(params, key)[0] ?? "";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Read the query string. Unknown columns are dropped, the core columns are always included, and ticked extras are added. */
export function parseCustomReport(params: Params): CustomReportQuery {
  const optional = new Set(COLUMNS.filter((column) => !column.core).map((column) => column.key));
  const asked = new Set(all(params, "cols").filter((key) => optional.has(key)));
  const columns = COLUMNS.filter((column) => column.core || asked.has(column.key)).map((column) => column.key);
  const extras = COLUMNS.filter((column) => asked.has(column.key)).map((column) => column.key);
  const filters = Object.fromEntries(FILTERS.map(({ key }) => [key, all(params, FILTER_PARAM(key))])) as Record<FilterKey, string[]>;
  const from = one(params, "from");
  const to = one(params, "to");
  return { columns, extras, filters, from: DATE.test(from) ? from : "", to: DATE.test(to) ? to : "" };
}

/** The same query as a query string, for the Excel download link. */
export function customReportQueryString(query: CustomReportQuery): string {
  const out = new URLSearchParams();
  for (const key of query.extras) out.append("cols", key);
  for (const { key } of FILTERS) for (const value of query.filters[key]) out.append(FILTER_PARAM(key), value);
  if (query.from) out.set("from", query.from);
  if (query.to) out.set("to", query.to);
  return out.toString();
}

const IST_OFFSET_MS = 330 * 60 * 1000;
export function istDay(value: string, endOfDay: boolean): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0) - IST_OFFSET_MS);
}

/** A condition on a plain text field: the chosen values, with BLANK meaning "nothing recorded". */
function textIn(field: string, values: string[]): Prisma.EnrollmentWhereInput {
  const real = values.filter((value) => value !== BLANK);
  const ors: Prisma.EnrollmentWhereInput[] = [];
  if (real.length) ors.push({ employee: { [field]: { in: real } } });
  if (values.includes(BLANK)) ors.push({ employee: { OR: [{ [field]: null }, { [field]: "" }] } });
  return { OR: ors };
}

/** The database condition for a query: learners only, then every filter that has a choice made. */
export function customReportWhere(query: CustomReportQuery): Prisma.EnrollmentWhereInput {
  const and: Prisma.EnrollmentWhereInput[] = [learnersOnly];
  const f = query.filters;
  if (f.company.length) and.push({ employee: { companyId: { in: f.company } } });
  if (f.location.length) and.push(textIn("locationPlant", f.location));
  if (f.department.length) and.push(textIn("department", f.department));
  if (f.designation.length) and.push(textIn("designation", f.designation));
  const statuses = f.employeeStatus.filter((value): value is EmployeeStatus => value in EmployeeStatus);
  if (f.employeeStatus.length) and.push({ employee: { status: { in: statuses } } });
  if (f.course.length) and.push({ courseId: { in: f.course } });
  if (f.classroom.length) {
    const names = f.classroom.filter((value) => value !== BLANK);
    const ors: Prisma.EnrollmentWhereInput[] = [];
    if (names.length) ors.push({ classroom: { name: { in: names } } });
    if (f.classroom.includes(BLANK)) ors.push({ classroomId: null });
    and.push({ OR: ors });
  }
  if (f.teacher.length) {
    const ids = f.teacher.filter((value) => value !== BLANK);
    const ors: Prisma.EnrollmentWhereInput[] = [];
    if (ids.length) ors.push({ classroom: { teacherUserId: { in: ids } } });
    if (f.teacher.includes(BLANK)) ors.push({ OR: [{ classroomId: null }, { classroom: { teacherUserId: null } }] });
    and.push({ OR: ors });
  }
  const states = f.enrolStatus.filter((value): value is EnrollmentStatus => value in EnrollmentStatus);
  if (f.enrolStatus.length) and.push({ status: { in: states } });
  if (query.from || query.to) {
    and.push({ enrolledAt: { ...(query.from ? { gte: istDay(query.from, false) } : {}), ...(query.to ? { lte: istDay(query.to, true) } : {}) } });
  }
  return { AND: and };
}

export type CustomReport = { rows: ReportRow[]; total: number; truncated: boolean };

export async function loadCustomReport(query: CustomReportQuery, limit = MAX_REPORT_ROWS): Promise<CustomReport> {
  const where = customReportWhere(query);
  const [total, found] = await Promise.all([
    db.enrollment.count({ where }),
    db.enrollment.findMany({
      where,
      include: rowInclude(),
      orderBy: [{ course: { title: "asc" } }, { employee: { name: "asc" } }],
      take: limit,
    }),
  ]);
  const courseIds = [...new Set(found.map((row) => row.courseId))];
  const lessonCounts = new Map<string, number>();
  if (courseIds.length) {
    const courses = await db.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, contents: { where: { isPublished: true }, select: { _count: { select: { lessons: { where: { approvedAt: { not: null } } } } } } } },
    });
    for (const course of courses) lessonCounts.set(course.id, course.contents.reduce((sum, content) => sum + content._count.lessons, 0));
  }
  return { rows: found.map((row) => ({ ...row, totalLessons: lessonCounts.get(row.courseId) ?? 0 })), total, truncated: total > found.length };
}

export type FilterOption = { value: string; label: string };

/** What each filter dropdown offers, taken from what LMS actually holds. */
export async function loadFilterOptions(): Promise<Record<FilterKey, FilterOption[]>> {
  const distinct = async (field: "locationPlant" | "department" | "designation"): Promise<FilterOption[]> => {
    const rows = await db.employee.findMany({
      where: { enrollments: { some: learnersOnly } },
      distinct: [field],
      select: { locationPlant: true, department: true, designation: true },
      orderBy: { [field]: "asc" },
    });
    const values = rows.map((row) => (row[field] ?? "").trim());
    const options = [...new Set(values.filter(Boolean))].map((value) => ({ value, label: value }));
    return values.some((value) => !value) ? [...options, { value: BLANK, label: "(not recorded)" }] : options;
  };
  const [companies, location, department, designation, courses, classrooms, teachers] = await Promise.all([
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    distinct("locationPlant"), distinct("department"), distinct("designation"),
    db.course.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true } }),
    db.classroom.findMany({ distinct: ["name"], orderBy: { name: "asc" }, select: { name: true } }),
    db.user.findMany({ where: { coursesTaught: { some: {} } }, include: { employee: true }, orderBy: [{ employee: { name: "asc" } }, { email: "asc" }] }),
  ]);
  return {
    company: companies.map((c) => ({ value: c.id, label: c.name })),
    location, department, designation,
    employeeStatus: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }],
    course: courses.map((c) => ({ value: c.id, label: c.title })),
    classroom: [...classrooms.map((c) => ({ value: c.name, label: c.name })), { value: BLANK, label: "(no classroom)" }],
    teacher: [...teachers.map((t) => ({ value: t.id, label: t.employee ? `${t.employee.name} (${t.employee.employeeCode})` : t.email })), { value: BLANK, label: "(no teacher)" }],
    enrolStatus: [{ value: "NOT_STARTED", label: "Not started" }, { value: "IN_PROGRESS", label: "In progress" }, { value: "COMPLETED", label: "Completed" }],
  };
}

export function reportCells(row: ReportRow, columnKeys: string[]): Cell[] {
  const byKey = new Map(COLUMNS.map((column) => [column.key, column]));
  return columnKeys.map((key) => byKey.get(key)?.value(row) ?? "");
}
