"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * A page that lists uploaded content shows each file's progress (queued, processing, done), but the
 * server renders that once. Without this the badge stays on "QUEUED" until someone reloads, however
 * quickly the worker finishes. While anything is still being processed this asks the page to
 * re-read itself every few seconds, and stops by itself once everything has settled.
 */
export function ProcessingWatcher({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      // A background tab has nobody to show it to.
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [active, everyMs, router]);
  return null;
}
