"use client";

import { useActionState, useState } from "react";
import { askCourseAi, type CourseAiState } from "@/actions/course-ai";

export function CourseAiAssistant({ courseId }: { courseId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<CourseAiState, FormData>(askCourseAi, {});

  return <div className="card">
    <h2>AI course assistant</h2>
    {!open ? <button type="button" onClick={() => setOpen(true)}>Ask AI about this course</button> : <form action={formAction} className="form">
      <input type="hidden" name="courseId" value={courseId} />
      <label>Your question<textarea name="question" placeholder="Ask anything related to this course content..." required /></label>
      <div className="form-row">
        <button disabled={pending}>{pending ? "Asking..." : "Ask AI"}</button>
        <button className="secondary" type="button" onClick={() => setOpen(false)}>Close</button>
      </div>
      {state.message && <p className="message error">{state.message}</p>}
      {state.answer && <div className="ai-answer"><strong>Answer</strong><p>{state.answer}</p></div>}
      <p className="muted">Answers are limited to the published course material.</p>
    </form>}
  </div>;
}
