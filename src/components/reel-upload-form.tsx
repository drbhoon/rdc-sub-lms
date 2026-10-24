"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { withBase } from "@/lib/base-path";
import { MAX_REEL_BYTES, MAX_REEL_SECONDS } from "@/lib/reels";

/** Reads how long a video is, in the browser, before anything is sent. */
function videoLength(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    const done = (seconds: number | null) => { URL.revokeObjectURL(url); resolve(seconds); };
    probe.onloadedmetadata = () => done(Number.isFinite(probe.duration) ? Math.round(probe.duration) : null);
    probe.onerror = () => done(null);
    probe.src = url;
  });
}

/** Upload a short MP4 as a reel. Checks size and length here, so a long video is turned away before it travels. */
export function ReelUploadForm({ courseId }: { courseId: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    setOk(false);
    if (!(file instanceof File) || !file.size) { setMessage("Choose a video file."); return; }
    if (file.size > MAX_REEL_BYTES) { setMessage(`A reel must be under ${MAX_REEL_BYTES / 1048576} MB. For a longer video, add it as a lesson.`); return; }
    setBusy(true);
    setMessage("Checking the video…");
    const seconds = await videoLength(file);
    if (seconds !== null && seconds > MAX_REEL_SECONDS) {
      setBusy(false);
      setMessage(`This video is ${Math.round(seconds / 60 * 10) / 10} minutes. A reel is at most ${MAX_REEL_SECONDS / 60} minutes; for a longer video, add it as a lesson.`);
      return;
    }
    if (seconds !== null) data.set("durationSeconds", String(seconds));
    setMessage("Uploading…");
    try {
      const response = await fetch(withBase(`/api/courses/${courseId}/reels`), { method: "POST", body: data });
      const body = await response.json().catch(() => ({})) as { message?: string };
      setOk(response.ok);
      setMessage(body.message ?? (response.ok ? "Added." : "The upload failed."));
      if (response.ok) { form.current?.reset(); router.refresh(); }
    } catch {
      setMessage("The upload did not go through. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return <form ref={form} onSubmit={submit} className="form">
    <label>Video (MP4, up to {MAX_REEL_BYTES / 1048576} MB and {MAX_REEL_SECONDS / 60} minutes)<input name="file" type="file" accept="video/mp4,.mp4" required /></label>
    <label>Title<input name="title" required minLength={3} maxLength={150} placeholder="Check the slump before you pour" /></label>
    <label>Caption (optional)<textarea name="caption" maxLength={500} rows={2} /></label>
    {message && <p className={ok ? "message success" : "message"} role="status">{message}</p>}
    <button disabled={busy}>{busy ? "Working..." : "Add reel"}</button>
  </form>;
}
