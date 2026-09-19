/** One "bytes=start-end" range (the form browsers send for media), clamped to the file. */
export function byteRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) { // "bytes=-500": the last 500 bytes
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}
