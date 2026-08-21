import { z } from "zod";

/**
 * Settings the app reads from the environment.
 *
 * Every optional one belongs HERE rather than in a `process.env.X ?? "…"`
 * at the point of use, because of how they arrive. docker-compose forwards
 * them as `KEY: ${KEY:-}`, which DEFINES the variable as an empty string when
 * the .env does not set it — and an empty string is neither nullish nor a
 * missing key, so `??` and Zod's `.default()` both keep it. The realtime voice
 * assistant failed on every attempt for exactly this reason: it posted
 * `model: ""` to OpenAI, which rejects the call, while the compose file said
 * in a comment that an unset value changed nothing.
 *
 * `withoutBlanks` below makes that comment true, once, for everything.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_COOKIE_NAME: z.string().default("rdc_lms_session"),
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
  STORAGE_PROVIDER: z.enum(["local"]).default("local"),
  STORAGE_ROOT: z.string().default("./storage"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(100),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z.string().transform((v) => v === "true").default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("RDC Learning <noreply@rdc.in>"),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_RESEND_SECONDS: z.coerce.number().int().positive().default(60),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.4-mini"),
  // Continuous voice, over OpenAI Realtime. Overridable so the model can be
  // changed without a deploy, which is the whole reason they are settings.
  OPENAI_REALTIME_MODEL: z.string().default("gpt-realtime-2.1-mini"),
  OPENAI_REALTIME_TRANSCRIPTION_MODEL: z.string().default("gpt-realtime-whisper"),
  CRON_SECRET: z.string().optional(),
});

/**
 * A variable set to nothing is a variable that was not set. See the note on
 * `schema` above: without this, a blank forwarded by compose beats the
 * default and reaches the app as "".
 */
const withoutBlanks = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => (value ?? "").trim() !== ""),
);

export const env = schema.parse(withoutBlanks);
