import { describe, expect, it } from "vitest";
import { classroomKey, hasClassroomColumns, planClassrooms } from "./classroom-import";

const row = (classroom: string, teacher: string, learner: string, extra: Record<string, string> = {}) =>
  ({ CLASSROOM: classroom, TEACHER_EMAIL: teacher, LEARNER_EMAIL: learner, ...extra });

describe("classroom upload plan", () => {
  it("groups learners into rooms with one teacher each, reading the teacher from any row of the room", () => {
    const plan = planClassrooms([
      row("Class Room 01", "Meena.Iyer@rdc.in", "a@rdc.in", { LEARNER_NAME: "Asha", EMP_CODE: "A1" }),
      row("Class Room 01", "", "b@rdc.in"),
      row("Class Room 02", "", "c@example.com"),
      row("class room 02", "raj@rdc.in", "d@rdc.in"),
    ]);
    expect(plan.errors).toEqual([]);
    expect(plan.classrooms).toEqual([
      { name: "Class Room 01", teacherEmail: "meena.iyer@rdc.in", learnerEmails: ["a@rdc.in", "b@rdc.in"] },
      { name: "Class Room 02", teacherEmail: "raj@rdc.in", learnerEmails: ["c@example.com", "d@rdc.in"] },
    ]);
    expect(plan.learners[0]).toEqual({ email: "a@rdc.in", name: "Asha", employeeCode: "A1", company: "", designation: "" });
  });

  it("scales to 50 rooms of 10 learners without trouble", () => {
    const rows = Array.from({ length: 500 }, (_, i) => {
      const room = Math.floor(i / 10) + 1;
      return row(`Class Room ${String(room).padStart(2, "0")}`, `teacher${room}@rdc.in`, `learner${i + 1}@rdc.in`);
    });
    const plan = planClassrooms(rows);
    expect(plan.errors).toEqual([]);
    expect(plan.classrooms).toHaveLength(50);
    expect(plan.classrooms.every((room) => room.learnerEmails.length === 10)).toBe(true);
    expect(plan.learners).toHaveLength(500);
  });

  it("refuses a room with two different teachers, naming both", () => {
    const plan = planClassrooms([row("Room A", "x@rdc.in", "a@rdc.in"), row("Room A", "y@rdc.in", "b@rdc.in")]);
    expect(plan.errors).toEqual([`"Room A" names more than one teacher: x@rdc.in (row 2), y@rdc.in (row 3). A classroom has one teacher.`]);
  });

  it("refuses a learner placed in two rooms, but not one listed twice in the same room", () => {
    const plan = planClassrooms([
      row("Room A", "", "a@rdc.in"),
      row("Room B", "", "A@rdc.in"),
      row("Room A", "", "a@rdc.in"),
    ]);
    expect(plan.errors).toEqual([`Row 3: a@rdc.in is already placed in "Room A" on row 2. A learner can sit in only one classroom.`]);
    expect(plan.classrooms[0].learnerEmails).toEqual(["a@rdc.in"]);
  });

  it("reports every bad row at once", () => {
    const plan = planClassrooms([
      row("", "", "a@rdc.in"),
      row("Room A", "not-an-email", "b@rdc.in"),
      row("Room A", "", "also bad"),
      row("x".repeat(81), "", "c@rdc.in"),
    ]);
    expect(plan.errors).toEqual([
      "Row 2: CLASSROOM is blank.",
      `Row 3: TEACHER_EMAIL "not-an-email" is not an e-mail address.`,
      `Row 4: LEARNER_EMAIL "also bad" is not an e-mail address.`,
      "Row 5: classroom name is longer than 80 characters.",
    ]);
  });

  it("allows an empty room, set up before its learners are known", () => {
    const plan = planClassrooms([row("Room Z", "z@rdc.in", "")]);
    expect(plan.errors).toEqual([]);
    expect(plan.classrooms).toEqual([{ name: "Room Z", teacherEmail: "z@rdc.in", learnerEmails: [] }]);
  });

  it("accepts common variants of the headings", () => {
    expect(hasClassroomColumns({ "Class Room": "", "Teacher": "", "Email ID": "" })).toBe(true);
    expect(hasClassroomColumns({ EMAIL: "" })).toBe(false);
    const plan = planClassrooms([{ "Class Room": "Room A", "Teacher E-mail": "t@rdc.in", "Email": "a@rdc.in", "Name": "Asha" }]);
    expect(plan.classrooms).toEqual([{ name: "Room A", teacherEmail: "t@rdc.in", learnerEmails: ["a@rdc.in"] }]);
    expect(plan.learners[0].name).toBe("Asha");
  });

  it("matches room names case- and space-insensitively", () => {
    expect(classroomKey("  Class   Room 7 ")).toBe(classroomKey("class room 7"));
  });
});
