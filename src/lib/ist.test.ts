import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { datesToIst } from "./excel-response";
import { formatIst, formatIstDate, parseIstLocal, toExcelIst, toIstLocalInput } from "./ist";

describe("IST formatting", () => {
  // 04:00 UTC is 09:30 in India.
  const morning = new Date("2026-09-18T04:00:00Z");
  // 20:00 UTC on the 18th is already 01:30 on the 19th in India.
  const lateUtc = new Date("2026-09-18T20:00:00Z");

  it("prints the Indian wall-clock time and says so", () => {
    expect(formatIst(morning)).toMatch(/18 Sept? 2026, 9:30 am IST/i);
  });

  it("uses the Indian calendar date, which can differ from the UTC date", () => {
    expect(formatIstDate(lateUtc)).toMatch(/19 Sept? 2026/);
    expect(formatIst(lateUtc)).toMatch(/19 Sept? 2026, 1:30 am IST/i);
  });

  it("prints nothing for a missing date", () => {
    expect(formatIst(null)).toBe("");
    expect(formatIstDate(undefined)).toBe("");
  });

  it("shifts a date by +05:30 for Excel", () => {
    expect(toExcelIst(morning).toISOString()).toBe("2026-09-18T09:30:00.000Z");
  });
});

describe("Excel exports", () => {
  it("rewrites every date cell to IST exactly once, leaving other cells and the source Date alone", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Details");
    const submitted = new Date("2026-09-18T04:00:00Z");
    sheet.addRow(["Learner", "Date", "Submission"]);
    sheet.addRow(["Asha", submitted, submitted]);
    sheet.getCell("B2").numFmt = "yyyy-mm-dd";

    datesToIst(workbook);

    expect((sheet.getCell("B2").value as Date).toISOString()).toBe("2026-09-18T09:30:00.000Z");
    expect((sheet.getCell("C2").value as Date).toISOString()).toBe("2026-09-18T09:30:00.000Z");
    expect(sheet.getCell("B2").numFmt).toBe("yyyy-mm-dd"); // an export's own format is kept
    expect(sheet.getCell("C2").numFmt).toBe("dd-mmm-yyyy hh:mm"); // an unformatted date gets date and time
    expect(sheet.getCell("A2").value).toBe("Asha");
    expect(submitted.toISOString()).toBe("2026-09-18T04:00:00.000Z"); // the record's own Date is untouched
  });
});

describe("date-time boxes are India time", () => {
  it("reads what an admin typed as IST, not as the server's UTC", () => {
    // 10:00 in India is 04:30 UTC.
    expect(parseIstLocal("2026-10-12T10:00")?.toISOString()).toBe("2026-10-12T04:30:00.000Z");
    expect(parseIstLocal("2026-10-12 00:15")?.toISOString()).toBe("2026-10-11T18:45:00.000Z");
  });

  it("rejects blanks, junk and dates that do not exist", () => {
    for (const bad of ["", null, undefined, "tomorrow", "2026-10-12", "2026-02-31T10:00", "2026-13-01T10:00"]) {
      expect(parseIstLocal(bad as string)).toBeNull();
    }
  });

  it("round-trips through the box value", () => {
    const date = parseIstLocal("2026-12-31T23:45")!;
    expect(toIstLocalInput(date)).toBe("2026-12-31T23:45");
    expect(toIstLocalInput(null)).toBe("");
  });
});
