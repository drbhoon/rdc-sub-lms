"use client";

import { useActionState } from "react";
import { importClassrooms, type ClassroomImportState } from "@/actions/classrooms";

/** The classroom file upload. Its own component so a refused file can list every problem, not just the first. */
export function ClassroomUploadForm({ courseId }: { courseId: string }) {
  const [state, formAction, pending] = useActionState<ClassroomImportState, FormData>(importClassrooms, {});
  return <form action={formAction} className="form">
    <input type="hidden" name="courseId" value={courseId} />
    <label>Classroom CSV or Excel<input type="file" name="file" accept=".csv,.xlsx,.xls" required /></label>
    {state.message && <div className={state.ok ? "message" : "message error-box"}>
      <p>{state.message}</p>
      {state.details && <ul className="requirement-list">{state.details.map((line) => <li key={line}>{line}</li>)}</ul>}
    </div>}
    <button disabled={pending}>{pending ? "Applying the file…" : "Upload classrooms"}</button>
  </form>;
}
