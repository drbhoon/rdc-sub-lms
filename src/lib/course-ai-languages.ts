export const COURSE_AI_LANGUAGE_CODES = ["en", "hi", "ta", "te", "kn", "ml"] as const;

export type CourseAiLanguage = (typeof COURSE_AI_LANGUAGE_CODES)[number];

export const COURSE_AI_LANGUAGE_NAMES: Record<CourseAiLanguage, string> = {
  en: "English",
  hi: "Hindi",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  ml: "Malayalam",
};

export function isCourseAiLanguage(value: string | null): value is CourseAiLanguage {
  return value !== null && COURSE_AI_LANGUAGE_CODES.some((code) => code === value);
}
