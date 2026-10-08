"use client";

import { useMemo, useState, useTransition } from "react";
import { clearFinalSchedule, scheduleFinal } from "@/actions/final-schedule";

export type ScheduleRow = {
  /** The classroom id, or "none" for learners in no classroom. */
  key: string;
  name: string;
  learners: number;
  /** "Not scheduled", or when it opens and closes, already in India time. */
  scheduleText: string;
  scheduled: boolean;
  /** Where the room stands now, for the badge. */
  status: "NOT_SCHEDULED" | "SCHEDULED" | "OPEN" | "CLOSED";
};

const BADGE: Record<ScheduleRow["status"], string> = {
  NOT_SCHEDULED: "Not scheduled",
  SCHEDULED: "Scheduled",
  OPEN: "Open now",
  CLOSED: "Closed",
};

/**
 * Schedule the final for whole classrooms at once: tick them, give the time it
 * opens (and, if wanted, closes), press Schedule. Times are India time.
 *
 * What is sent is built from this component's own state rather than read back
 * from the form, for the reason the roster does the same: React resets a form
 * after its action, which would untick everything while the screen still said
 * it was chosen.
 */
export function FinalSchedulePanel({ courseId, rows }: { courseId: string; rows: ScheduleRow[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [message, setMessage] = useState("");
  const [busy, startBusy] = useTransition();
  const live = useMemo(() => rows.filter((row) => picked.has(row.key)), [rows, picked]);
  const allTicked = rows.length > 0 && live.length === rows.length;

  function toggle(key: string) {
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function send(action: typeof scheduleFinal) {
    const data = new FormData();
    data.set("courseId", courseId);
    data.set("opensAt", opensAt);
    data.set("closesAt", closesAt);
    for (const row of live) data.append("scope", row.key);
    setMessage("");
    startBusy(async () => {
      const result = await action({}, data);
      setMessage(result.message ?? "");
    });
  }

  return <div className="form final-schedule">
    <div className="table-wrap"><table>
      <thead><tr>
        <th><input type="checkbox" aria-label="Select every classroom" checked={allTicked}
          onChange={() => setPicked(allTicked ? new Set() : new Set(rows.map((row) => row.key)))} /></th>
        <th>Classroom</th><th>Learners</th><th>Final assessment</th>
      </tr></thead>
      <tbody>
        {rows.map((row) => <tr key={row.key}>
          <td><input type="checkbox" checked={picked.has(row.key)} onChange={() => toggle(row.key)} aria-label={`Select ${row.name}`} /></td>
          <td><strong>{row.name}</strong></td>
          <td>{row.learners}</td>
          <td><span className={`badge${row.status === "NOT_SCHEDULED" ? " badge-muted" : ""}`}>{BADGE[row.status]}</span><br /><span className="muted">{row.scheduleText}</span></td>
        </tr>)}
        {!rows.length && <tr><td colSpan={4}>This course has no classrooms or learners yet.</td></tr>}
      </tbody>
    </table></div>

    <div className="form-row">
      <label>Opens (India time)
        <input type="datetime-local" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} />
      </label>
      <label>Closes (India time, optional)
        <input type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} />
      </label>
    </div>
    <p className="muted">
      {live.length} classroom{live.length === 1 ? "" : "s"} selected. Learners can start the final from the time it opens;
      after the closing time nobody new can start it. Someone already part-way through keeps their own time limit.
    </p>
    {message && <p className="message">{message}</p>}
    <div className="button-row">
      <button type="button" disabled={busy || live.length === 0} onClick={() => send(scheduleFinal)}>{busy ? "Working..." : "Schedule selected"}</button>
      <button type="button" className="secondary" disabled={busy || live.length === 0} onClick={() => send(clearFinalSchedule)}>Clear schedule for selected</button>
    </div>
  </div>;
}
