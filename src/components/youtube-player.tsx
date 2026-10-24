"use client";

import { useEffect, useRef, useState } from "react";
import { loadYouTubeApi, type YtPlayer } from "@/components/youtube-api";

/**
 * A YouTube video inside a lesson.
 *
 * Plays from YouTube's privacy-friendly address, without "related videos from
 * other channels" at the end, and tells the lesson how much has really been
 * watched: onTick fires once a second while it plays (and once more when it
 * pauses or ends), so the lesson can count only time actually spent watching.
 */
export function YoutubePlayer({ videoId, startAt = 0, onTick, onEnded }: {
  videoId: string;
  startAt?: number;
  onTick: (currentTime: number, flush?: boolean) => void;
  onEnded: (currentTime: number) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState("");
  // Latest callbacks, without re-creating the player every time the parent re-renders.
  const handlers = useRef({ onTick, onEnded });
  useEffect(() => { handlers.current = { onTick, onEnded }; });

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let player: YtPlayer | undefined;
    const target = document.createElement("div");
    holder.current?.appendChild(target);

    loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      player = new YT.Player(target, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, origin: window.location.origin, ...(startAt > 5 ? { start: Math.floor(startAt) } : {}) },
        events: {
          onStateChange: (event) => {
            window.clearInterval(timer);
            const time = event.target.getCurrentTime();
            if (event.data === YT.PlayerState.PLAYING) {
              timer = window.setInterval(() => handlers.current.onTick(event.target.getCurrentTime()), 1000);
            } else if (event.data === YT.PlayerState.PAUSED) {
              handlers.current.onTick(time, true);
            } else if (event.data === YT.PlayerState.ENDED) {
              handlers.current.onTick(time, true);
              handlers.current.onEnded(time);
            }
          },
          onError: () => setProblem("This video cannot be played. It may be private, removed, or not allowed to be shown here."),
        },
      });
    }).catch(() => setProblem("YouTube could not be reached from this device or network."));

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      try { player?.destroy(); } catch { /* the page is going away anyway */ }
      target.remove();
    };
  }, [videoId, startAt]);

  return <div className="youtube-frame">
    <div ref={holder} className="youtube-holder" />
    {problem && <p className="message error">{problem}</p>}
  </div>;
}
