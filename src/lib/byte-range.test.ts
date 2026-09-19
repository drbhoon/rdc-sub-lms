import { describe, expect, it } from "vitest";
import { byteRange } from "./byte-range";

describe("HTTP byte ranges for video", () => {
  it("serves the whole file when no range is asked for", () => {
    expect(byteRange(null, 1000)).toBeNull();
    expect(byteRange("items=0-5", 1000)).toBeNull();
  });
  it("reads an open-ended range, as a browser starting playback sends", () => {
    expect(byteRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(byteRange("bytes=400-", 1000)).toEqual({ start: 400, end: 999 });
  });
  it("clamps a range past the end, and reads a suffix range", () => {
    expect(byteRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });
  it("refuses a range that starts beyond the file", () => {
    expect(byteRange("bytes=1000-", 1000)).toBe("invalid");
    expect(byteRange("bytes=50-10", 1000)).toBe("invalid");
  });
});
