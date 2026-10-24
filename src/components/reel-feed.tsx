"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { recordReelView } from "@/actions/reels";
import { YoutubePlayer } from "@/components/youtube-player";

export type ReelItem = {
  id: string;
  title: string;
  caption: string | null;
  /** Where an uploaded reel plays from. */
  src?: string;
  youtubeId?: string;
  watched: boolean;
};

/**
 * Bite-sized videos, one per screen, scrolled like a feed. The reel in view
 * plays (muted until the learner turns sound on, which phones require) and the
 * others pause. What was watched is saved quietly; nothing here is required.
 */
export function ReelFeed({ reels }: { reels: ReelItem[] }) {
  const [open, setOpen] = useState(false);
  const [sound, setSound] = useState(false);
  const [seen, setSeen] = useState(() => new Set(reels.filter((reel) => reel.watched).map((reel) => reel.id)));
  const feed = useRef<HTMLDivElement>(null);
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const progress = useRef(new Map<string, { seconds: number; sent: number }>());

  const save = useCallback((id: string, ended: boolean) => {
    const current = progress.current.get(id);
    if (!current) return;
    if (!ended && current.seconds - current.sent < 3) return;
    current.sent = current.seconds;
    recordReelView(id, current.seconds, ended).catch(() => {});
    if (ended) setSeen((previous) => new Set(previous).add(id));
  }, []);

  // Play the reel the feed is scrolled to; pause the rest. Each reel is exactly one screen tall,
  // so the scroll position says which one that is (and it works without any observer support).
  useEffect(() => {
    const element = feed.current;
    if (!open || !element) return;
    const sync = () => {
      const index = Math.round(element.scrollTop / Math.max(1, element.clientHeight));
      reels.forEach((reel, position) => {
        const video = videos.current.get(reel.id);
        if (!video) return;
        if (position === index) video.play().catch(() => {});
        else if (!video.paused) { video.pause(); save(reel.id, false); }
      });
    };
    element.addEventListener("scroll", sync, { passive: true });
    sync();
    return () => element.removeEventListener("scroll", sync);
  }, [open, reels, save]);

  useEffect(() => { videos.current.forEach((video) => { video.muted = !sound; }); }, [sound, open]);

  function track(id: string, seconds: number) {
    const current = progress.current.get(id) ?? { seconds: 0, sent: 0 };
    current.seconds = Math.max(current.seconds, Math.floor(seconds));
    progress.current.set(id, current);
    if (current.seconds - current.sent >= 10) save(id, false);
  }

  return <div className="reels-card">
    <div className="reels-head">
      <div>
        <h2>Reels</h2>
        <p className="muted">{reels.length} quick video{reels.length === 1 ? "" : "s"} for this course. Optional.{seen.size ? ` You have watched ${seen.size}.` : ""}</p>
      </div>
      <button type="button" className={open ? "secondary" : ""} onClick={() => setOpen((value) => !value)}>{open ? "Close reels" : "Watch reels"}</button>
    </div>
    {open && <>
      <div className="button-row">
        <button type="button" className="secondary" onClick={() => setSound((value) => !value)}>{sound ? "Sound on" : "Sound off"}</button>
        <span className="muted">Scroll for the next reel.</span>
      </div>
      <div className="reel-feed" ref={feed}>
        {reels.map((reel) => <div className="reel" data-reel={reel.id} key={reel.id}>
          <div className="reel-stage">
            {reel.src && <video
              className="reel-video" src={reel.src} playsInline loop={false} muted preload="metadata" controls
              ref={(node) => { if (node) videos.current.set(reel.id, node); else videos.current.delete(reel.id); }}
              onTimeUpdate={(event) => track(reel.id, event.currentTarget.currentTime)}
              onEnded={(event) => { track(reel.id, event.currentTarget.duration || event.currentTarget.currentTime); save(reel.id, true); }}
            />}
            {reel.youtubeId && <YoutubePlayer
              videoId={reel.youtubeId}
              onTick={(currentTime) => track(reel.id, currentTime)}
              onEnded={(currentTime) => { track(reel.id, currentTime); save(reel.id, true); }}
            />}
          </div>
          <div className="reel-caption">
            <strong>{seen.has(reel.id) ? "✓ " : ""}{reel.title}</strong>
            {reel.caption && <p>{reel.caption}</p>}
          </div>
        </div>)}
      </div>
    </>}
  </div>;
}
