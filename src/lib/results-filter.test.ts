import { describe, expect, it } from "vitest";
import {
  NONE, matchesFilter, noFilter, reconcile, resultFilterFromParams, resultFilterQuery, resultFilterWhere, rowsForChoices,
  type FilterRow,
} from "./results-filter";

const rows: FilterRow[] = [
  { employeeId: "e1", classroomId: "r1", teacherUserId: "t1" },
  { employeeId: "e2", classroomId: "r1", teacherUserId: "t1" },
  { employeeId: "e3", classroomId: "r2", teacherUserId: "t2" },
  { employeeId: "e4", classroomId: "r3", teacherUserId: null }, // a classroom with no teacher yet
  { employeeId: "e5", classroomId: null, teacherUserId: null }, // in no classroom
];
const ids = (list: FilterRow[]) => list.map((row) => row.employeeId);

describe("matchesFilter", () => {
  it("shows everyone with no filter", () => {
    expect(rows.every((row) => matchesFilter(row, noFilter))).toBe(true);
  });

  it("filters by classroom, by teacher, by learner, and by all together", () => {
    expect(ids(rows.filter((row) => matchesFilter(row, { ...noFilter, classroom: "r1" })))).toEqual(["e1", "e2"]);
    expect(ids(rows.filter((row) => matchesFilter(row, { ...noFilter, teacher: "t2" })))).toEqual(["e3"]);
    expect(ids(rows.filter((row) => matchesFilter(row, { ...noFilter, learner: "e2" })))).toEqual(["e2"]);
    expect(ids(rows.filter((row) => matchesFilter(row, { learner: "e3", classroom: "r1", teacher: "" })))).toEqual([]);
  });

  it("NONE picks the learners with no classroom, or whose classroom has no teacher", () => {
    expect(ids(rows.filter((row) => matchesFilter(row, { ...noFilter, classroom: NONE })))).toEqual(["e5"]);
    expect(ids(rows.filter((row) => matchesFilter(row, { ...noFilter, teacher: NONE })))).toEqual(["e4", "e5"]);
  });
});

describe("dropdown choices narrow each other", () => {
  it("a dropdown offers what the OTHER two allow, not its own selection", () => {
    const filter = { ...noFilter, classroom: "r1" };
    expect(ids(rowsForChoices(rows, filter, "learner"))).toEqual(["e1", "e2"]);
    expect(ids(rowsForChoices(rows, filter, "classroom"))).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });

  it("clears a choice the others have made impossible", () => {
    // the dropdown just used wins; the older choice that no longer fits is the one cleared
    expect(reconcile(rows, { learner: "e3", classroom: "r1", teacher: "" }, "classroom")).toEqual({ learner: "", classroom: "r1", teacher: "" });
    expect(reconcile(rows, { learner: "", classroom: "r2", teacher: "t1" }, "classroom")).toEqual({ learner: "", classroom: "r2", teacher: "" });
    expect(reconcile(rows, { learner: "e1", classroom: "r1", teacher: "t2" }, "classroom")).toEqual({ learner: "e1", classroom: "r1", teacher: "" });
  });

  it("keeps choices that fit together", () => {
    const fits = { learner: "e1", classroom: "r1", teacher: "t1" };
    expect(reconcile(rows, fits)).toEqual(fits);
  });
});

describe("the Excel download follows the same filter", () => {
  it("round-trips through the query string and leaves unset fields out", () => {
    const filter = { learner: "", classroom: "r1", teacher: NONE };
    const query = resultFilterQuery(filter);
    expect(query).toBe("?classroom=r1&teacher=none");
    expect(resultFilterFromParams(new URLSearchParams(query))).toEqual(filter);
    expect(resultFilterQuery(noFilter)).toBe("");
  });

  it("turns into a database condition", () => {
    expect(resultFilterWhere(noFilter)).toEqual({});
    expect(resultFilterWhere({ learner: "e1", classroom: "r1", teacher: "t1" })).toEqual({
      AND: [{ employeeId: "e1" }, { classroomId: "r1" }, { classroom: { teacherUserId: "t1" } }],
    });
    expect(resultFilterWhere({ ...noFilter, classroom: NONE })).toEqual({ AND: [{ classroomId: null }] });
    expect(resultFilterWhere({ ...noFilter, teacher: NONE })).toEqual({
      AND: [{ OR: [{ classroomId: null }, { classroom: { teacherUserId: null } }] }],
    });
  });
});
