import { describe, expect, it } from "vitest";
import { matchesFileSignature } from "./file-signatures";

describe("upload signatures", () => {
  it("accepts supported binary signatures", () => {
    expect(matchesFileSignature(".pdf", new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(matchesFileSignature(".ppt", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe(true);
    expect(matchesFileSignature(".pptx", new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(matchesFileSignature(".mp4", new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]))).toBe(true);
  });
  it("rejects renamed or unsupported content", () => {
    expect(matchesFileSignature(".pdf", new TextEncoder().encode("not a pdf"))).toBe(false);
    expect(matchesFileSignature(".exe", new Uint8Array([0x4d, 0x5a]))).toBe(false);
  });
});
