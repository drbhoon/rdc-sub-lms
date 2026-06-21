import { describe, expect, it } from "vitest";
import { generateOtp, normalizeEmail, randomToken, tokenHash } from "./security";

describe("security helpers", () => {
  it("normalizes email without changing its content", () => expect(normalizeEmail(" Person@RDC.IN ")).toBe("person@rdc.in"));
  it("generates six-digit OTP values", () => expect(generateOtp()).toMatch(/^\d{6}$/));
  it("hashes session tokens deterministically", () => {
    const token = randomToken();
    expect(token).toHaveLength(43);
    expect(tokenHash(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash(token)).toBe(tokenHash(token));
  });
});
