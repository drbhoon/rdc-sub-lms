import { describe, expect, it, vi } from "vitest";
import { courseTextWithOcr, OCR_TEXT_TOO_SHORT_MESSAGE } from "./course-text";

describe("courseTextWithOcr", () => {
  it("uses normal extraction without running OCR when enough text is available", async () => {
    const runOcr = vi.fn(async () => "unused OCR text");
    const result = await courseTextWithOcr(
      "Employees inspect the mill before startup and record lubrication, alignment, and vibration readings for preventive maintenance.",
      runOcr,
    );

    expect(result.usedOcr).toBe(false);
    expect(runOcr).not.toHaveBeenCalled();
  });

  it("uses OCR when an image-only document has no selectable text", async () => {
    const runOcr = vi.fn(async () =>
      "Preventive maintenance requires scheduled inspections, lubrication checks, alignment measurements, and documented corrective action.",
    );
    const result = await courseTextWithOcr("", runOcr);

    expect(result.usedOcr).toBe(true);
    expect(result.text).toContain("scheduled inspections");
    expect(runOcr).toHaveBeenCalledOnce();
  });

  it("returns a clear error when OCR also finds too little text", async () => {
    await expect(courseTextWithOcr("", async () => "Unreadable"))
      .rejects.toThrow(OCR_TEXT_TOO_SHORT_MESSAGE);
  });
});
