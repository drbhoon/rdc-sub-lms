import nodemailer from "nodemailer";
import { env } from "@/lib/env";

export async function sendOtpEmail(email: string, otp: string) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    throw new Error("SMTP is not configured");
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });

  await transport.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject: "Your RDC Learning login code",
    text: `Your RDC Learning login code is ${otp}. It expires in ${env.OTP_TTL_MINUTES} minutes.`,
    html: `<p>Your RDC Learning login code is <strong>${otp}</strong>.</p><p>It expires in ${env.OTP_TTL_MINUTES} minutes.</p>`,
  });
}
