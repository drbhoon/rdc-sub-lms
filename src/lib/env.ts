import { z } from "zod";

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
  CRON_SECRET: z.string().optional(),
});

export const env = schema.parse(process.env);
