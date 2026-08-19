import { describe, expect, it } from "vitest";
import { groupDuplicateCompanies, normaliseCompany, pickSurvivingCompany } from "./company-merge";

const at = (iso: string) => new Date(iso);

describe("normaliseCompany", () => {
  it("treats the two RDC spellings as the same firm", () => {
    // The real pair that broke the enrolment picker.
    expect(normaliseCompany("RDC Concrete (India) Limited"))
      .toBe(normaliseCompany("RDC Concrete India Ltd."));
  });

  it("canonicalises legal suffixes", () => {
    expect(normaliseCompany("Robo Silicon Pvt. Ltd."))
      .toBe(normaliseCompany("Robo Silicon Private Limited"));
  });

  it("ignores case and surrounding space", () => {
    expect(normaliseCompany("  rdc concrete india ltd  "))
      .toBe(normaliseCompany("RDC Concrete India Ltd."));
  });

  it("keeps genuinely different firms apart", () => {
    expect(normaliseCompany("RDC Concrete India Ltd."))
      .not.toBe(normaliseCompany("Robo Silicon Pvt. Ltd."));
    expect(normaliseCompany("Third Party"))
      .not.toBe(normaliseCompany("RDC Concrete India Ltd."));
  });
});

describe("groupDuplicateCompanies", () => {
  it("returns only the sets that actually have a duplicate", () => {
    const groups = groupDuplicateCompanies([
      { id: "a", name: "RDC Concrete (India) Limited", createdAt: at("2026-01-01"), employeeCount: 3 },
      { id: "b", name: "RDC Concrete India Ltd.", createdAt: at("2026-08-01"), employeeCount: 900 },
      { id: "c", name: "Third Party", createdAt: at("2026-08-01"), employeeCount: 12 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((c) => c.id).sort()).toEqual(["a", "b"]);
  });
});

describe("pickSurvivingCompany", () => {
  it("keeps the company with the most employees", () => {
    const { keep, drop } = pickSurvivingCompany([
      { id: "old", name: "RDC Concrete (India) Limited", createdAt: at("2026-01-01"), employeeCount: 3 },
      { id: "new", name: "RDC Concrete India Ltd.", createdAt: at("2026-08-01"), employeeCount: 900 },
    ]);
    expect(keep.id).toBe("new");
    expect(drop.map((c) => c.id)).toEqual(["old"]);
  });

  it("breaks a tie towards the older record", () => {
    // The one HR has been using, and the one courses are already linked to.
    const { keep } = pickSurvivingCompany([
      { id: "newer", name: "RDC Concrete India Ltd.", createdAt: at("2026-08-01"), employeeCount: 5 },
      { id: "older", name: "RDC Concrete (India) Limited", createdAt: at("2026-01-01"), employeeCount: 5 },
    ]);
    expect(keep.id).toBe("older");
  });

  it("does not mutate the caller's array", () => {
    const group = [
      { id: "a", name: "A Ltd", createdAt: at("2026-01-01"), employeeCount: 1 },
      { id: "b", name: "A Limited", createdAt: at("2026-02-01"), employeeCount: 9 },
    ];
    pickSurvivingCompany(group);
    expect(group.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
