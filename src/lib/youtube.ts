/**
 * Turning whatever a person pastes into a YouTube video id, and nothing else.
 *
 * Only youtube.com, youtu.be and youtube-nocookie.com are accepted, and only a
 * well-formed 11-character id is ever kept, so a pasted address cannot smuggle
 * anything else into the page that embeds it.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "youtube-nocookie.com", "music.youtube.com"]);

export function parseYoutubeUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (VIDEO_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else id = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1] ?? null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** "754" -> "12:34", "3725" -> "1:02:05". */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "12:34" or "1:02:05" or "90" (seconds) -> seconds; null when it is not a time. */
export function parseClock(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d{1,2}$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}
