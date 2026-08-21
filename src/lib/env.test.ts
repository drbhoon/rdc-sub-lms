import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A variable set to nothing must behave as a variable that was not set.
 *
 * docker-compose forwards optional settings as `KEY: ${KEY:-}`, so an .env
 * that omits one still DEFINES it in the container, as an empty string. Zod's
 * `.default()` fills in for `undefined` only, so before `withoutBlanks` the
 * empty string won and reached the app as "". That is how the voice assistant
 * came to post `model: ""` to OpenAI and fail on every attempt, while the
 * compose file said in a comment that an unset value changed nothing.
 *
 * These read env at module load, so each one resets the module registry.
 */
async function loadEnv() {
  vi.resetModules();
  return (await import("./env")).env;
}

describe("env", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/lms");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("falls back to the default realtime model when the variable is blank", async () => {
    vi.stubEnv("OPENAI_REALTIME_MODEL", "");
    expect((await loadEnv()).OPENAI_REALTIME_MODEL).toBe("gpt-realtime-2.1-mini");
  });

  it("falls back when the variable is only whitespace", async () => {
    vi.stubEnv("OPENAI_REALTIME_MODEL", "   ");
    expect((await loadEnv()).OPENAI_REALTIME_MODEL).toBe("gpt-realtime-2.1-mini");
  });

  it("still honours a real value, which is the point of the setting", async () => {
    vi.stubEnv("OPENAI_REALTIME_MODEL", "gpt-realtime");
    expect((await loadEnv()).OPENAI_REALTIME_MODEL).toBe("gpt-realtime");
  });

  it("applies the same rule to the transcription model", async () => {
    vi.stubEnv("OPENAI_REALTIME_TRANSCRIPTION_MODEL", "");
    expect((await loadEnv()).OPENAI_REALTIME_TRANSCRIPTION_MODEL).toBe("gpt-realtime-whisper");
  });

  it("does not let a blank API key look like a configured one", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect((await loadEnv()).OPENAI_API_KEY).toBeUndefined();
  });

  it("keeps a blank numeric setting off the port", async () => {
    // Number("") is 0, so an empty SMTP_PORT used to coerce to port 0.
    vi.stubEnv("SMTP_PORT", "");
    expect((await loadEnv()).SMTP_PORT).toBe(587);
  });
});
