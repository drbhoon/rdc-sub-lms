import { describe, expect, it } from "vitest";
import {
  chooseKeeper, normalizeMobile, possibleDuplicateGroups, samePersonGroups, type PersonRecord,
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
