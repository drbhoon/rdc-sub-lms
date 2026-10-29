import { describe, expect, it } from "vitest";
import {
  chooseKeeper, normalizeEmployeeCode, normalizeMobile, possibleDuplicateGroups, sameNameGroups, samePersonGroups, suggestKeeper, type PersonRecord,
} from "./employee-duplicates";

const day = (n: number) => new Date(`2026-10-${String(n).padStart(2, "0")}T00:00:00Z`);
const person = (code: string, extra: Partial<PersonRecord> = {}): PersonRecord => ({
  id: `id-${code}`, employeeCode: code, name: "Nilanchal Gouda", email: `${code}@x.com`, mobileNumber: "9876543210",
  personId: null, masterSeenAt: null, createdAt: day(1), ...extra,
});

describe("chooseKeeper", () => {
  it("keeps the record the master saw most recently", () => {
    const keeper = chooseKeeper([person("A", { masterSeenAt: day(5) }), person("B", { masterSeenAt: day(9) })]);
    expect(keeper.employeeCode).toBe("B");
  });
  it("prefers any record the master has seen over one it has not", () => {
    const keeper = chooseKeeper([person("A", { createdAt: day(20) }), person("B", { masterSeenAt: day(2), createdAt: day(1) })]);
    expect(keeper.employeeCode).toBe("B");
  });
  it("with neither seen by the master, keeps the newest (the one just added)", () => {
    const keeper = chooseKeeper([person("OLD", { createdAt: day(1) }), person("NEW", { createdAt: day(10) })]);
    expect(keeper.employeeCode).toBe("NEW");
  });
  it("is stable when everything ties", () => {
    expect(chooseKeeper([person("B"), person("A")]).employeeCode).toBe("A");
  });
});

describe("samePersonGroups", () => {
  it("groups records that share a portal person id", () => {
    const groups = samePersonGroups([person("A", { personId: "7" }), person("B", { personId: "7" }), person("C", { personId: "8" }), person("D")]);
    expect(groups.map((g) => g.map((r) => r.employeeCode))).toEqual([["A", "B"]]);
  });
  it("never groups records with no person id", () => {
    expect(samePersonGroups([person("A"), person("B")])).toEqual([]);
  });
});

describe("normalizeMobile", () => {
  it("matches the same number written two ways", () => {
    expect(normalizeMobile("+91 98765 43210")).toBe("9876543210");
    expect(normalizeMobile("9876543210")).toBe("9876543210");
  });
  it("ignores anything too short to be a mobile", () => {
    expect(normalizeMobile("12345")).toBe("");
    expect(normalizeMobile(null)).toBe("");
  });
});

describe("possibleDuplicateGroups", () => {
  it("lists records with the same name and mobile the portal has not linked", () => {
    const groups = possibleDuplicateGroups([person("A"), person("B", { email: "other@x.com" })]);
    expect(groups).toHaveLength(1);
  });
  it("does not list a pair the portal already links (the automatic rule handles it)", () => {
    expect(possibleDuplicateGroups([person("A", { personId: "7" }), person("B", { personId: "7" })])).toEqual([]);
  });
  it("lists a pair when only one side is linked", () => {
    expect(possibleDuplicateGroups([person("A", { personId: "7" }), person("B")])).toHaveLength(1);
  });
  it("does not match different people who happen to share a name", () => {
    expect(possibleDuplicateGroups([person("A"), person("B", { mobileNumber: "9000000000" })])).toEqual([]);
  });
  it("needs a mobile number to suggest a match", () => {
    expect(possibleDuplicateGroups([person("A", { mobileNumber: null }), person("B", { mobileNumber: null })])).toEqual([]);
  });
});

describe("normalizeEmployeeCode", () => {
  it("treats case, spacing, punctuation and padding zeros as no difference", () => {
    expect(normalizeEmployeeCode("rdc-0123")).toBe("RDC123");
    expect(normalizeEmployeeCode(" RDC 123 ")).toBe("RDC123");
    expect(normalizeEmployeeCode("00123")).toBe("123");
    expect(normalizeEmployeeCode("123")).toBe("123");
  });
  it("keeps real differences", () => {
    expect(normalizeEmployeeCode("RDC123")).not.toBe(normalizeEmployeeCode("RDC1230"));
    expect(normalizeEmployeeCode("R100")).toBe("R100");
    expect(normalizeEmployeeCode("123")).not.toBe(normalizeEmployeeCode("RDC123"));
  });
});

describe("sameNameGroups", () => {
  const named = (code: string, inMaster: boolean, extra: Partial<PersonRecord> = {}) => ({ ...person(code, { mobileNumber: null, ...extra }), inMaster });
  it("lists a name shared by an uploaded record and a master one", () => {
    expect(sameNameGroups([named("A", true), named("B", false), named("C", true, { name: "Someone Else" })])).toHaveLength(1);
  });
  it("ignores two genuine people who are both in the master", () => {
    expect(sameNameGroups([named("A", true, { personId: "p1" }), named("B", true, { personId: "p2" })])).toHaveLength(0);
  });
  it("leaves pairs the portal already links to the automatic rule", () => {
    expect(sameNameGroups([named("A", false, { personId: "p1" }), named("B", false, { personId: "p1" })])).toHaveLength(0);
  });
  it("matches names loosely", () => {
    expect(sameNameGroups([named("A", true, { name: "Anil  Kumar" }), named("B", false, { name: "anil kumar." })])).toHaveLength(1);
  });
});

describe("suggestKeeper", () => {
  const row = (code: string, extra: object = {}) => ({ employeeCode: code, inMaster: false, activity: 0, createdAt: day(1), ...extra });
  it("prefers the master's record, then the one with learning, then the oldest", () => {
    expect(suggestKeeper([row("A", { activity: 9 }), row("B", { inMaster: true })]).employeeCode).toBe("B");
    expect(suggestKeeper([row("A"), row("B", { activity: 3 })]).employeeCode).toBe("B");
    expect(suggestKeeper([row("A", { createdAt: day(5) }), row("B", { createdAt: day(2) })]).employeeCode).toBe("B");
  });
});
