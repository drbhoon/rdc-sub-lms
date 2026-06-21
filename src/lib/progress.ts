export function documentIsComplete(pageCount: number, viewedPages: Iterable<number>) {
  if (pageCount <= 0) return false;
  const pages = new Set([...viewedPages].filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount));
  return pages.size === pageCount;
}

export function videoIsComplete(durationSeconds: number | null, watchedSeconds: number, requiredPercent: number) {
  if (!durationSeconds || durationSeconds <= 0 || watchedSeconds < 0) return false;
  return watchedSeconds / durationSeconds * 100 >= requiredPercent;
}
