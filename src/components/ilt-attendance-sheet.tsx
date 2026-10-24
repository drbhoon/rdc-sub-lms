"use client";

import { useState, useTransition } from "react";
import { markIltAttendance } from "@/actions/ilt";

export type AttendanceRow = { enrollmentId: string; name: string; code: string; present: boolean; joinedAt: string | null };

/** The instructor's sheet: tick who was there, save. Saving again corrects it. */
export function IltAttendanceSheet({ sessionId, rows }: { sessionId: string; rows: AttendanceRow[] }) {
  const [ticked, setTicked] = useState(() => new Set(rows.filter((row) => row.present).map((row) => row.enrollmentId)));
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState("");

  function toggle(id: string) {
    setSaved("");
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function save() {
    const form = new FormData();
    form.set("sessionId", sessionId);
    for (const id of ticked) form.append("present", id);
    startTransition(async () => { await markIltAttendance(form); setSaved(`Saved: ${ticked.size} of ${rows.length} present.`); });
  }

  if (!rows.length) return <p className="muted">No learners are enrolled yet.</p>;
  return <div className="ilt-sheet">
    <p className="muted">
      Tick the people who attended. Presence completes this session for them; anyone left unticked is marked absent.
      The “opened the link” column only shows who pressed Join: Google Meet does not tell us who really attended.
    </p>
    <div className="button-row">
      <button type="button" className="secondary" onClick={() => { setSaved(""); setTicked(new Set(rows.map((row) => row.enrollmentId))); }}>Tick everyone</button>
      <button type="button" className="secondary" onClick={() => { setSaved(""); setTicked(new Set()); }}>Clear</button>
    </div>
    <div className="table-wrap scroll-list">
      <table>
        <thead><tr><th>Present</th><th>Learner</th><th>Opened the link</th></tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.enrollmentId}>
            <td><input type="checkbox" checked={ticked.has(row.enrollmentId)} onChange={() => toggle(row.enrollmentId)} aria-label={`${row.name} present`} /></td>
            <td>{row.name} <span className="muted">({row.code})</span></td>
            <td>{row.joinedAt ?? "-"}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="button-row">
      <button type="button" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save attendance"}</button>
      {saved && <span className="message success" role="status">{saved}</span>}
    </div>
  </div>;
}
