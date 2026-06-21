import { describe, expect, it } from "vitest";
import { documentIsComplete, videoIsComplete } from "./progress";

describe("progress rules", () => {
  it("requires every valid document page", () => {
    expect(documentIsComplete(3, [1, 2])).toBe(false);
    expect(documentIsComplete(3, [1, 2, 3, 99])).toBe(true);
  });
  it("uses the configured video threshold", () => {
    expect(videoIsComplete(100, 79, 80)).toBe(false);
    expect(videoIsComplete(100, 80, 80)).toBe(true);
    expect(videoIsComplete(null, 100, 80)).toBe(false);
  });
});
