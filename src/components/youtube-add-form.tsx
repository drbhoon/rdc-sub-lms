"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addYoutubeContent } from "@/actions/youtube";
import { loadYouTubeApi } from "@/components/youtube-api";
import { formatClock, parseYoutubeUrl } from "@/lib/youtube";

type Detected = { id: string; seconds: number; title: string } | null;

/**
 * Paste a YouTube link to add it to a course. The video's length and title are
 * read from YouTube itself in a moment, so a teacher does not have to look them
 * up, and the length can still be typed over.
 */
export function YoutubeAddForm({ courseId }: { courseId: string }) {
  const [state, formAction, pending] = useActionState(addYoutubeContent, {});
  const [url, setUrl] = useState("");
  const [detected, setDetected] = useState<Detected>(null);
  // The link we have finished asking YouTube about (found or not), so "checking" is simply "not finished yet".
  const [settled, setSettled] = useState<string | null>(null);
  const probe = useRef<HTMLDivElement>(null);
  const id = parseYoutubeUrl(url);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: number | undefined;
    const target = document.createElement("div");
    probe.current?.appendChild(target);
    loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      const player = new YT.Player(target, {
        videoId: id,
        host: "https://www.youtube-nocookie.com",
        events: {
          onReady: (event) => {
            let tries = 0;
            // The length is not always known the instant the player is ready.
            timer = window.setInterval(() => {
              tries += 1;
              const seconds = Math.round(event.target.getDuration());
              if (seconds > 0 || tries >= 8) {
                window.clearInterval(timer);
                if (!cancelled) {
                  setDetected(seconds > 0 ? { id, seconds, title: event.target.getVideoData().title ?? "" } : null);
                  setSettled(id);
                }
                try { player.destroy(); } catch { /* nothing to clean up */ }
              }
            }, 500);
          },
          onError: () => { if (!cancelled) setSettled(id); },
        },
      });
    }).catch(() => { if (!cancelled) setSettled(id); });
    return () => { cancelled = true; window.clearInterval(timer); target.remove(); };
  }, [id]);

  const shown = detected && detected.id === id ? detected : null;
  const detecting = Boolean(id) && settled !== id;
  return <form action={formAction} className="form">
    <input type="hidden" name="courseId" value={courseId} />
    <input type="hidden" name="detectedSeconds" value={shown?.seconds ?? ""} />
    <input type="hidden" name="detectedTitle" value={shown?.title ?? ""} />
    <label>YouTube link
      <input name="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" required />
    </label>
    {url && !id && <p className="error">That does not look like a YouTube video link.</p>}
    {id && detecting && <p className="muted">Checking the video with YouTube…</p>}
    {id && shown && <p className="muted">Found: <strong>{shown.title || "video"}</strong> · {formatClock(shown.seconds)}</p>}
    <div className="form-row">
      <label>Title (optional)<input name="title" placeholder={shown?.title || "Taken from YouTube"} maxLength={150} /></label>
      <label>Length (optional)<input name="length" placeholder={shown ? formatClock(shown.seconds) : "12:30"} inputMode="numeric" /></label>
    </div>
    <p className="muted">
      Learners watch it on YouTube, so it needs YouTube to be reachable on their device, and YouTube may show an advertisement.
      The video is not copied here, so no AI summary or quiz is made from it: add your own questions in the module&apos;s quiz.
    </p>
    {state.message && <p className="message">{state.message}</p>}
    <div ref={probe} className="visually-hidden" aria-hidden="true" />
    <button disabled={pending || !id}>{pending ? "Adding…" : "Add YouTube video"}</button>
  </form>;
}
