"use client";

import { useMemo, useState } from "react";
import { withBase } from "@/lib/base-path";
import {
  NONE, matchesFilter, noFilter, reconcile, resultFilterQuery, rowsForChoices, type FilterField, type ResultFilter,
} from "@/lib/results-filter";

export type ResultColumn = { key: string; label: string; weight: number };

export type ResultRow = {
  id: string;
  employeeId: string;
  name: string;
  code: string;
  classroomId: string | null;
  classroomName: string | null;
  teacherUserId: string | null;
  teacherName: string;
  teacherCode: string;
  /** One score per column, null where the learner has not been scored yet. */
  scores: (number | null)[];
  total: number;
  pending: number;
};

const scoreText = (score: number | null) => (score === null ? "-" : `${Math.round(score * 10) / 10}`);
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/**
 * Every learner's course result, with a dropdown under each of the first three
 * column headings (Learner, Classroom, Teacher) to narrow the table.
 *
 * Classroom and Teacher always list every choice, so changing your mind is one
 * click. The Learner list is the long one, so it narrows to whoever the
 * classroom and teacher choices leave, and choosing a classroom or teacher
 * clears a learner (or the other of the two) that no longer fits. The Excel
 * download carries the same choices.
 */
export function CourseResultsTable({ courseId, columns, rows }: { courseId: string; columns: ResultColumn[]; rows: ResultRow[] }) {
  const [filter, setFilter] = useState<ResultFilter>(noFilter);

  function choose(field: FilterField, value: string) {
    setFilter((current) => reconcile(rows, { ...current, [field]: value }, field));
  }

  const visible = useMemo(() => rows.filter((row) => matchesFilter(row, filter)), [rows, filter]);

  // Learners: only those the classroom and teacher choices leave. Classrooms and teachers: all of them.
  const options = useMemo(() => {
    const learners = new Map<string, string>();
    const classrooms = new Map<string, string>();
    const teachers = new Map<string, string>();
    let noClassroom = false;
    let noTeacher = false;
    for (const row of rowsForChoices(rows, filter, "learner")) {
      learners.set(row.employeeId, `${row.name} (${row.code})`);
    }
    for (const row of rows) {
      if (row.classroomId) classrooms.set(row.classroomId, row.classroomName ?? "Classroom");
      else noClassroom = true;
    }
    for (const row of rows) {
      if (row.teacherUserId) teachers.set(row.teacherUserId, row.teacherCode ? `${row.teacherName} (${row.teacherCode})` : row.teacherName);
      else noTeacher = true;
    }
    const sorted = (map: Map<string, string>) => [...map.entries()].sort((a, b) => byName(a[1], b[1]));
    return { learners: sorted(learners), classrooms: sorted(classrooms), teachers: sorted(teachers), noClassroom, noTeacher };
  }, [rows, filter]);

  const filtered = Boolean(filter.learner || filter.classroom || filter.teacher);
  const download = withBase(`/api/courses/${courseId}/grades${resultFilterQuery(filter)}`);

  return <>
    <p>
      <a className="button secondary" href={download}>{filtered ? "Download these results (Excel)" : "Download results Excel"}</a>
      {filtered && <> <button type="button" className="secondary" onClick={() => setFilter(noFilter)}>Clear filters</button></>}
    </p>
    <div className="table-wrap">
      <table className="results-table">
        <thead>
          <tr>
            <th>Learner</th><th>Classroom</th><th>Teacher</th>
            {columns.map((column) => <th key={column.key}>{column.label}<br /><span className="muted">weight {column.weight}</span></th>)}
            <th>Course result /100</th>
          </tr>
          <tr className="filter-row">
            <td>
              <select aria-label="Show one learner" value={filter.learner} onChange={(event) => choose("learner", event.target.value)}>
                <option value="">All learners ({options.learners.length})</option>
                {options.learners.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </td>
            <td>
              <select aria-label="Show one classroom" value={filter.classroom} onChange={(event) => choose("classroom", event.target.value)}>
                <option value="">All classrooms</option>
                {options.classrooms.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                {options.noClassroom && <option value={NONE}>No classroom</option>}
              </select>
            </td>
            <td>
              <select aria-label="Show one teacher" value={filter.teacher} onChange={(event) => choose("teacher", event.target.value)}>
                <option value="">All teachers</option>
                {options.teachers.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                {options.noTeacher && <option value={NONE}>No teacher</option>}
              </select>
            </td>
            <td colSpan={columns.length + 1} className="muted">Showing {visible.length} of {rows.length} learner{rows.length === 1 ? "" : "s"}</td>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => <tr key={row.id}>
            <td><strong>{row.name}</strong><br /><span className="muted">{row.code}</span></td>
            <td>{row.classroomName ?? <span className="muted">-</span>}</td>
            <td>{row.teacherName ? <><strong>{row.teacherName}</strong>{row.teacherCode && <><br /><span className="muted">{row.teacherCode}</span></>}</> : <span className="muted">-</span>}</td>
            {row.scores.map((score, index) => <td key={columns[index]?.key ?? index}>{scoreText(score)}</td>)}
            <td><strong>{row.total}</strong>{row.pending > 0 && <><br /><span className="muted">{row.pending} pending</span></>}</td>
          </tr>)}
          {!rows.length && <tr><td colSpan={columns.length + 4}>No learners are enrolled yet.</td></tr>}
          {rows.length > 0 && !visible.length && <tr><td colSpan={columns.length + 4}>No learner matches these choices.</td></tr>}
        </tbody>
      </table>
    </div>
  </>;
}
