/**
 * Reels: short vertical videos that sit beside a course's lessons.
 *
 * They are meant to be quick — a minute, a tip, a reminder — so the limits are
 * small: a phone clip is a few megabytes, and a single request carries it
 * (the platform's proxy allows 60 MB). A reel can also be a YouTube Short.
 */
export const MAX_REEL_BYTES = 40 * 1024 * 1024;
export const MAX_REEL_SECONDS = 180;
export const MAX_REELS_PER_COURSE = 60;

export type ReelFile = { name: string; type: string; size: number };

/** An error message if the file cannot be a reel, else null. `head` is the file's first bytes. */
export function reelFileProblem(file: ReelFile, head: Uint8Array): string | null {
  if (!/\.mp4$/i.test(file.name)) return "A reel must be an MP4 video (.mp4). Phone videos are usually already MP4.";
  if (file.type && file.type !== "video/mp4") return "A reel must be an MP4 video (.mp4).";
  if (file.size <= 0) return "The file is empty.";
  if (file.size > MAX_REEL_BYTES) return `A reel must be under ${MAX_REEL_BYTES / 1048576} MB. For a longer or larger video, add it to the course as a lesson instead.`;
  const isMp4 = String.fromCharCode(...head.slice(4, 8)) === "ftyp";
  if (!isMp4) return "This file is not a real MP4 video.";
  return null;
}

/** The length the browser reported, kept only if it is sensible. Null when unknown. */
export function reelSeconds(value: unknown): number | null {
  const seconds = Math.round(Number(value));
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= MAX_REEL_SECONDS ? seconds : null;
}

/** Whether a view counts as having watched it: most of it, or to the end. Never gates anything; it only shows who uses reels. */
export function reelWatched(watchedSeconds: number, durationSeconds: number | null, ended: boolean): boolean {
  if (ended) return true;
  return durationSeconds ? watchedSeconds >= durationSeconds * 0.8 : false;
}
