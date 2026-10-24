"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { launchScorm } from "@/actions/scorm";
import { ScormApi } from "@/lib/scorm-api";
import { withBase } from "@/lib/base-path";
import type { Commit } from "@/lib/scorm-runtime";

export type ScormStanding = {
  /** What opening it would do now. */
  next: "start" | "resume" | "retry" | "review" | "locked";
  attemptsUsed: number;
  maxAttempts: number;
  bestScore: number | null;
  passed: boolean;
};

type Running = { api: ScormApi; src: string; attemptId: string | null; mode: string };

const LABEL: Record<ScormStanding["next"], string> = {
  start: "Start course", resume: "Resume course", retry: "Try again", review: "Review course", locked: "No attempts left",
};

/**
 * A SCORM course running inside the lesson page.
 *
 * The package's scripts look for an object called API (SCORM 1.2) or
 * API_1484_11 (2004) on a parent window, so both are put on this page before
 * the package is loaded into the frame. Every save the package makes is sent
 * to the server, which is what decides pass or fail; the LMS adds no verdict
 * of its own.
 */
export function ScormPlayer({ lessonId, title, standing }: { lessonId: string; title: string; standing: ScormStanding }) {
  const router = useRouter();
  const [running, setRunning] = useState<Running | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const frame = useRef<HTMLIFrameElement>(null);
  const live = useRef<Running | null>(null);
  const announced = useRef(false);

  const send = useCallback((attemptId: string | null, commit: Commit, beacon = false) => {
    if (!attemptId) return;
    const body = JSON.stringify({ attemptId, commit });
    const url = withBase("/api/scorm/commit");
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon(url, new Blob([body], { type: "application/json" })); return; }
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true })
      .then((response) => (response.ok ? response.json() : null))
      .then((result: { passed?: boolean; locked?: boolean } | null) => {
        if (result?.passed && !announced.current) {
          announced.current = true;
          setMessage("You have passed this course. Well done.");
          router.refresh();
        } else if (result?.locked) {
          router.refresh();
        }
      })
      .catch(() => {});
  }, [router]);

  // Hand the package its API, and keep it in sync with the running course.
  useEffect(() => {
    live.current = running;
    if (!running) return;
    const w = window as unknown as Record<string, unknown>;
    w.API = running.api.api12();
    w.API_1484_11 = running.api.api2004();
    return () => { delete w.API; delete w.API_1484_11; };
  }, [running]);

  // Packages commit when they choose to (some only on exit), so save what they hold every half minute as well:
  // a dropped connection or a closed laptop then costs a few seconds of progress, not the whole session.
  useEffect(() => {
    if (!running?.attemptId) return;
    const timer = window.setInterval(() => {
      const current = live.current;
      if (current?.attemptId && current.api.dirty) send(current.attemptId, current.api.flush());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [running, send]);

  // Leaving the page part-way saves where the learner got to, so they can resume.
  useEffect(() => {
    const leave = () => {
      const current = live.current;
      if (current?.attemptId && current.api.dirty) send(current.attemptId, current.api.flush(), true);
    };
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); leave(); };
  }, [send]);

  function open() {
    setMessage("");
    announced.current = false;
    startTransition(async () => {
      const result = await launchScorm(lessonId);
      if ("error" in result) { setMessage(result.error); return; }
      if ("locked" in result) { setMessage("You have used both attempts. Ask your administrator to reset them if you need another."); router.refresh(); return; }
      const api = new ScormApi(result.init, (commit) => send(result.attemptId, commit));
      setRunning({ api, attemptId: result.attemptId, mode: result.mode, src: withBase(`/api/scorm/${result.contentId}/${result.launchPath}`) });
    });
  }

  function close() {
    const current = running;
    if (current?.attemptId && current.api.dirty) send(current.attemptId, current.api.flush());
    setRunning(null);
    // Let the save land before the page asks what the standing is.
    window.setTimeout(() => router.refresh(), 600);
  }

  if (running) {
    return <div className="scorm-run">
      <div className="scorm-bar">
        <strong>{title}</strong>
        {running.mode === "review" && <span className="muted">Review only: nothing is recorded.</span>}
        {running.mode === "preview" && <span className="muted">Preview: nothing is recorded.</span>}
        <span className="scorm-bar-actions">
          <button type="button" className="secondary" onClick={() => frame.current?.requestFullscreen?.().catch(() => {})}>Full screen</button>
          <button type="button" className="secondary" onClick={close}>Exit course</button>
        </span>
      </div>
      <iframe ref={frame} className="scorm-frame" src={running.src} title={title} allow="fullscreen; autoplay" allowFullScreen />
      {message && <p className="message success" role="status">{message}</p>}
    </div>;
  }

  const left = Math.max(0, standing.maxAttempts - standing.attemptsUsed);
  return <div className="scorm-card">
    <p className="muted">
      This is a self-paced course with its own test. Its result counts as it is: the pass mark is set inside the course.
      {" "}You have {standing.maxAttempts} attempts. If you leave part-way, you pick up where you stopped and that does not use an attempt.
    </p>
    <p>
      {standing.passed
        ? <strong>Passed{standing.bestScore !== null ? ` · score ${Math.round(standing.bestScore)}` : ""}</strong>
        : standing.next === "locked"
          ? <strong>Both attempts used. Ask your administrator to reset them.</strong>
          : <span>Attempt {Math.min(standing.attemptsUsed + (standing.next === "start" || standing.next === "retry" ? 1 : 0), standing.maxAttempts)} of {standing.maxAttempts}{left === 1 && standing.next === "retry" ? " (last attempt)" : ""}</span>}
    </p>
    <button type="button" disabled={pending || standing.next === "locked"} onClick={open}>{pending ? "Opening…" : LABEL[standing.next]}</button>
    {message && <p className="message" role="status">{message}</p>}
  </div>;
}
