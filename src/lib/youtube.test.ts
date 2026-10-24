import { describe, expect, it } from "vitest";
import { formatClock, parseClock, parseYoutubeUrl } from "./youtube";

const ID = "dQw4w9WgXcQ";

describe("parseYoutubeUrl", () => {
  it("reads the usual ways a link is copied", () => {
    for (const link of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&t=42s`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?si=abc`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}?feature=share`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
      `www.youtube.com/watch?v=${ID}`,
      `youtu.be/${ID}`,
      ID,
    ]) expect(parseYoutubeUrl(link), link).toBe(ID);
  });

  it("ignores spaces around a pasted link", () => {
    expect(parseYoutubeUrl(`   https://youtu.be/${ID}  `)).toBe(ID);
  });

  it("refuses anything that is not a YouTube video", () => {
    for (const link of [
      "",
      "hello",
      "https://vimeo.com/123456789",
      `https://evil.example.com/watch?v=${ID}`,
      `https://youtube.com.evil.example/watch?v=${ID}`,
      "https://www.youtube.com/watch",
      "https://www.youtube.com/playlist?list=PLabcdefghijklmnop",
      "https://www.youtube.com/watch?v=short",
      `javascript:alert(1)//youtu.be/${ID}`,
      `ftp://youtu.be/${ID}`,
    ]) expect(parseYoutubeUrl(link), link).toBeNull();
  });
});

describe("formatClock / parseClock", () => {
  it("formats minutes and hours", () => {
    expect(formatClock(754)).toBe("12:34");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(5)).toBe("0:05");
  });
  it("reads what a person types for a length", () => {
    expect(parseClock("12:34")).toBe(754);
    expect(parseClock("1:02:05")).toBe(3725);
    expect(parseClock("90")).toBe(90);
    expect(parseClock("")).toBeNull();
    expect(parseClock("12:3x")).toBeNull();
    expect(parseClock("1:2:3:4")).toBeNull();
  });
});
