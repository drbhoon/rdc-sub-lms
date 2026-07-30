export const REMINDER_DELAY_HOURS = 28;

export function reminderEnrollmentCutoff(now = new Date()) {
  return new Date(now.getTime() - REMINDER_DELAY_HOURS * 60 * 60_000);
}
