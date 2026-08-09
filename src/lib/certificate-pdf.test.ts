import { describe, expect, it } from "vitest";
import { createCertificatePdf } from "./certificate-pdf";

describe("createCertificatePdf", () => {
  it("creates a downloadable PDF certificate", async () => {
    const pdf = await createCertificatePdf({
      certificateId: "ABCD-123456",
      companyName: "Robo Silicon Private Limited",
      completedAt: new Date("2026-08-09T00:00:00.000Z"),
      courseTitle: "Manufacturing Sand: Operations, Quality and Customer Handling",
      employeeCode: "EMP-001",
      employeeName: "Certificate Test Learner",
    });

    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
  });
});
