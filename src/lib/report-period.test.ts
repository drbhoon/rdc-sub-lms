import { describe, expect, it } from "vitest";
import { getReportPeriod } from "./report-period";

describe("getReportPeriod", () => {
  const now = new Date("2026-06-26T10:30:00.000Z");

  it("defaults to the current IST month", () => {
    const period = getReportPeriod({}, now);
    expect(period.key).toBe("month");
    expect(period.fromInput).toBe("2026-06-01");
    expect(period.toInput).toBe("2026-06-26");
  });

  it("returns yesterday in IST", () => {
    const period = getReportPeriod({ period: "yesterday" }, now);
    expect(period.fromInput).toBe("2026-06-25");
    expect(period.toInput).toBe("2026-06-25");
  });

  it("accepts a valid custom range", () => {
    const period = getReportPeriod({ period: "custom", from: "2026-04-01", to: "2026-04-30" }, now);
    expect(period.key).toBe("custom");
    expect(period.label).toBe("2026-04-01 to 2026-04-30");
  });
});
