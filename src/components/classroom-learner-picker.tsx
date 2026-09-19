"use client";

import { useActionState, useMemo, useState } from "react";
import { assignLearnersToClassroom } from "@/actions/classrooms";

type Learner = { enrollmentId: string; name: string; employeeCode: string; email: string; classroomId: string | null };
type Room = { id: string; name: string };

const UNASSIGNED = "__unassigned__";

/**
 * Put enrolled learners into a classroom, with search.
 *
 * Replaces a plain multi-select, which with a few hundred learners meant
 * scrolling and ctrl-clicking through the whole course. Built the same way as
 * the enrolment picker: selection lives in React state, so it survives
 * searching and filtering, and only a window of the matching rows is painted.
 */
export function ClassroomLearnerPicker({ courseId, learners, rooms }: { courseId: string; learners: Learner[]; rooms: Room[] }) {
  const [query, setQuery] = useState("");
  const [showRoom, setShowRoom] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Selection clears once a move is done: those learners are where they were
  // meant to go, and leaving them ticked invites moving them again by accident.
  const [state, formAction, pending] = useActionState<{ message?: string }, FormData>(async (previous, data) => {
    const result = await assignLearnersToClassroom(previous, data);
    setSelected(new Set());
    return result;
  }, {});
  const roomName = useMemo(() => new Map(rooms.map((room) => [room.id, room.name])), [rooms]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return learners.filter((learner) => {
      if (showRoom === UNASSIGNED ? learner.classroomId : showRoom && learner.classroomId !== showRoom) return false;
      if (!term) return true;
      return [learner.name, learner.employeeCode, learner.email, roomName.get(learner.classroomId ?? "") ?? ""]
        .some((value) => value.toLowerCase().includes(term));
    });
  }, [learners, query, showRoom, roomName]);
  const shown = useMemo(() => filtered.slice(0, 100), [filtered]);

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const selectAllMatching = () => setSelected((current) => new Set([...current, ...filtered.map((learner) => learner.enrollmentId)]));
  const unassignedCount = learners.filter((learner) => !learner.classroomId).length;

  return <form action={formAction} className="form">
    <input type="hidden" name="courseId" value={courseId} />
    {[...selected].map((id) => <input key={id} type="hidden" name="enrollmentIds" value={id} />)}

    <div className="picker-tools">
      <label>Search learners<input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Name, code, e-mail or classroom" /></label>
      <label>Show<select value={showRoom} onChange={(event) => setShowRoom(event.currentTarget.value)}>
        <option value="">All learners ({learners.length})</option>
        <option value={UNASSIGNED}>Not in a classroom ({unassignedCount})</option>
        {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
      </select></label>
    </div>

    <p className="muted">
      {filtered.length} of {learners.length} learners shown{shown.length < filtered.length && ` — listing the first ${shown.length}, keep typing to narrow`}.{" "}
      {filtered.length > 0 && <button type="button" className="link-button" onClick={selectAllMatching}>Select all {filtered.length} matching</button>}
    </p>

    <div className="scroll-list">
      {shown.map((learner) => <label className="checkbox" key={learner.enrollmentId}>
        <input type="checkbox" checked={selected.has(learner.enrollmentId)} onChange={() => toggle(learner.enrollmentId)} />
        <span>{learner.name} ({learner.employeeCode})<br /><small>{learner.email} · {learner.classroomId ? roomName.get(learner.classroomId) : "Not in a classroom"}</small></span>
      </label>)}
      {!filtered.length && <p className="muted">No learner matches.</p>}
    </div>

    {selected.size > 0 && <p className="message">
      {selected.size} selected{" "}
      <button type="button" className="link-button" onClick={() => setSelected(new Set())}>Clear selection</button>
    </p>}

    <label>Move selected to<select name="classroomId" defaultValue="">
      <option value="">— Remove from classroom —</option>
      {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
    </select></label>
    {state.message && <p className="message">{state.message}</p>}
    <button disabled={pending || selected.size === 0}>{pending ? "Moving…" : `Move ${selected.size || ""} selected`.replace("  ", " ")}</button>
  </form>;
}
