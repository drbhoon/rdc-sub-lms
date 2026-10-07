import { describe, expect, it } from "vitest";
import { classroomTeacher } from "./classroom-teacher";

describe("classroomTeacher", () => {
  it("uses the employee record for name and code", () => {
    expect(classroomTeacher({ email: "t@rdc.in", employee: { name: "Tarun Teacher", employeeCode: "T001" } })).toEqual({ name: "Tarun Teacher", code: "T001" });
  });

  it("falls back to the e-mail, with no code, for a teacher who is not an employee", () => {
    expect(classroomTeacher({ email: "admin@rdc.in", employee: null })).toEqual({ name: "admin@rdc.in", code: "" });
  });

  it("is blank for a learner whose classroom has no teacher, or who has no classroom", () => {
    expect(classroomTeacher(null)).toEqual({ name: "", code: "" });
    expect(classroomTeacher(undefined)).toEqual({ name: "", code: "" });
  });
});
