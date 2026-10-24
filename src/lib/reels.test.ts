import { describe, expect, it } from "vitest";
import { MAX_REEL_BYTES, MAX_REEL_SECONDS, reelFileProblem, reelSeconds, reelWatched } from "./reels";

const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);

describe("reelFileProblem", () => {
  it("accepts a small MP4", () => {
    expect(reelFileProblem({ name: "tip.mp4", type: "video/mp4", size: 5_000_000 }, mp4)).toBeNull();
  });
  it("refuses other types, empty and oversized files", () => {
    expect(reelFileProblem({ name: "tip.mov", type: "video/quicktime", size: 5_000_000 }, mp4)).toMatch(/MP4/);
    expect(reelFileProblem({ name: "tip.mp4", type: "video/mp4", size: 0 }, mp4)).toMatch(/empty/);
    expect(reelFileProblem({ name: "tip.mp4", type: "video/mp4", size: MAX_REEL_BYTES + 1 }, mp4)).toMatch(/40 MB/);
  });
  it("refuses a file renamed to .mp4", () => {
    expect(reelFileProblem({ name: "tip.mp4", type: "video/mp4", size: 1000 }, new Uint8Array(12))).toMatch(/not a real MP4/);
  });
});

describe("reelSeconds", () => {
  it("keeps a sensible length and drops nonsense", () => {
    expect(reelSeconds("42.4")).toBe(42);
    expect(reelSeconds(0)).toBeNull();
    expect(reelSeconds(MAX_REEL_SECONDS + 1)).toBeNull();
    expect(reelSeconds("abc")).toBeNull();
  });
});

describe("reelWatched", () => {
  it("counts reaching the end or most of it", () => {
    expect(reelWatched(10, 60, true)).toBe(true);
    expect(reelWatched(49, 60, false)).toBe(true);
    expect(reelWatched(30, 60, false)).toBe(false);
    expect(reelWatched(30, null, false)).toBe(false);
  });
});
