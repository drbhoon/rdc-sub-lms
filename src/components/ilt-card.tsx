"use client";

import { useEffect, useState } from "react";
import { recordIltJoin } from "@/actions/ilt";
import { canJoin, sessionPhase, type SessionPhase } from "@/lib/ilt";

export type IltInfo = {
  startsAtIso: string;
  startsLabel: string;
  durationMinutes: number;
  meetUrl: string;
  instructorName: string | null;
  notes: string | null;
  /** The instructor's record: PRESENT, ABSENT, or nothing yet. */
  attendance: "PRESENT" | "ABSENT" | null;
};

const PHASE_TEXT: Record<SessionPhase, string> = {
  cancelled: "This session has been cancelled.",
  upcoming: "This session has not started yet. The Join button opens 15 minutes before.",
  open: "The session is about to start. You can join now.",
  live: "The session is on. Join now.",
  ended: "This session is over.",
};

/** A live online session as the learner sees it: when, who, a Join button that works at the right time, and whether they were marked present. */
export function IltCard({ lessonId, info }: { lessonId: string; info: IltInfo }) {
  const startsAt = new Date(info.startsAtIso);
  const [now, setNow] = useState(() => new Date());
  const [problem, setProblem] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(timer);
  }, []);
  const phase = sessionPhase({ startsAt, durationMinutes: info.durationMinutes, cancelledAt: null }, now);

  function noteJoin() {
    // The link opens in a new tab straight away; the instructor's hint is recorded on the side.
    recordIltJoin(lessonId).then((result) => { if (result.error) setProblem(result.error); }).catch(() => {});
  }

  return <div className="ilt-card">
    <p><strong>{info.startsLabel}</strong> · {info.durationMinutes} minutes{info.instructorName ? ` · with ${info.instructorName}` : ""}</p>
    {info.notes && <p>{info.notes}</p>}
    {info.attendance === "PRESENT"
      ? <p className="message success" role="status">You attended this session. It is complete.</p>
      : <p className="muted">{PHASE_TEXT[phase]}</p>}
    {info.attendance === "ABSENT" && phase === "ended" && <p className="message" role="status">The instructor has marked you absent from this session. Ask them if this is a mistake.</p>}
    {canJoin(phase) && info.attendance !== "PRESENT" && <p>
      <a className="button" href={info.meetUrl} target="_blank" rel="noreferrer" onClick={noteJoin}>Join the session (Google Meet)</a>
    </p>}
    {problem && <p className="message" role="status">{problem}</p>}
    <p className="muted">
      Join with your own name showing, from the Google account you use for work. Attendance is confirmed by the instructor after the
      session, and this lesson is completed once they have marked you present.
    </p>
  </div>;
}
