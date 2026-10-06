"use client";

import { startTransition, useActionState, useMemo, useState } from "react";
import { unenrolLearners } from "@/actions/enrollments";

export type RosterRow = {
  enrollmentId: string;
  name: string;
  employeeCode: string;
  email: string;
  company: string;
  classroom: string | null;
  enrolledOn: string;
  status: string;
  lessonsDone: number;
  totalLessons: number;
  quizAttempts: number;
};

/**
 * The people enrolled on a course, with a tick against each and one button to
 * take the ticked ones off. Several at a time, because a class that has left
 * is dozens, not one.
 */
export function LearnerRoster({ courseId, rows }: { courseId: string; rows: RosterRow[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  // Done: nothing is left ticked, and the next removal has to be confirmed afresh.
  const [state, action, pending] = useActionState(async (previous: Awaited<ReturnType<typeof unenrolLearners>>, data: FormData) => {
    const result = await unenrolLearners(previous, data);
    if (result.ok) { setPicked(new Set()); setConfirmed(false); }
    return result;
  }, {});
  const allTicked = rows.length > 0 && rows.every((row) => picked.has(row.enrollmentId));
  // Only ticks that are still on the page count: once a removal has refreshed
  // the list, a stale id must not keep the button looking armed.
  const live = useMemo(() => rows.filter((row) => picked.has(row.enrollmentId)), [rows, picked]);
  const started = live.filter((row) => row.lessonsDone > 0 || row.quizAttempts > 0).length;

  function toggle(id: string) {
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Submitted by hand rather than through the form's `action`: React resets a
  // form after its action finishes, which unticked every box while this
  // component's state (and the button) still said they were chosen. What is sent
  // is built from that state, so the screen and the request cannot disagree.
  return <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); startTransition(() => action(data)); }} className="form roster-form">
    <input type="hidden" name="courseId" value={courseId} />
    {live.map((row) => <input key={row.enrollmentId} type="hidden" name="enrollmentId" value={row.enrollmentId} />)}
    {confirmed && <input type="hidden" name="confirmRemove" value="on" />}
    <div className="table-wrap"><table>
      <thead><tr>
        <th><input type="checkbox" aria-label="Select everyone shown" checked={allTicked}
          onChange={() => setPicked(allTicked ? new Set() : new Set(rows.map((row) => row.enrollmentId)))} /></th>
        <th>Learner</th><th>E-mail</th><th>Company</th><th>Classroom</th><th>Enrolled on</th><th>Status</th><th>Progress</th>
      </tr></thead>
      <tbody>
        {rows.map((row) => <tr key={row.enrollmentId}>
          <td><input type="checkbox" checked={picked.has(row.enrollmentId)}
            onChange={() => toggle(row.enrollmentId)} aria-label={`Select ${row.name}`} /></td>
          <td><strong>{row.name}</strong><br /><span className="muted">{row.employeeCode}</span></td>
          <td>{row.email}</td>
          <td>{row.company}</td>
          <td>{row.classroom ?? <span className="muted">Unassigned</span>}</td>
          <td>{row.enrolledOn}</td>
          <td><span className="badge">{row.status.replaceAll("_", " ")}</span></td>
          <td>{row.lessonsDone}/{row.totalLessons} lessons{row.quizAttempts > 0 ? <><br /><span className="muted">{row.quizAttempts} quiz attempt{row.quizAttempts === 1 ? "" : "s"}</span></> : null}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan={8}>No learners match.</td></tr>}
      </tbody>
    </table></div>

    <div className="roster-actions">
      <p className="muted">
        {live.length} selected.
        {started > 0 && ` ${started} of them ${started === 1 ? "has" : "have"} started: removing them deletes their lesson progress on this course. Quiz results and feedback already given are kept.`}
      </p>
      <label className="checkbox"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Confirm: remove the selected learners from this course</label>
      {state.message && <p className="message">{state.message}</p>}
      <button className="danger" disabled={pending || live.length === 0}>{pending ? "Removing..." : live.length ? `Remove ${live.length} selected from course` : "Remove selected from course"}</button>
    </div>
  </form>;
}
