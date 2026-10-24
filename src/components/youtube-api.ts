"use client";

/**
 * Loads YouTube's player script once and hands back its `YT` object.
 *
 * The script is only fetched when a page actually needs a YouTube player, and
 * a second request for it while the first is still loading waits for the same
 * script rather than adding another.
 */
export type YtPlayer = {
  getCurrentTime(): number;
  getDuration(): number;
  getVideoData(): { title?: string };
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
};

type YtNamespace = {
  Player: new (element: HTMLElement | string, options: {
    videoId: string;
    host?: string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (event: { target: YtPlayer }) => void;
      onStateChange?: (event: { data: number; target: YtPlayer }) => void;
      onError?: (event: { data: number }) => void;
    };
  }) => YtPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number };
};

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<YtNamespace> | null = null;

export function loadYouTubeApi(): Promise<YtNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YtNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error("YouTube did not load"));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => { loading = null; reject(new Error("YouTube could not be reached")); };
    document.head.appendChild(script);
  });
  return loading;
}
