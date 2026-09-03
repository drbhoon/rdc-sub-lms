"use client";

import { useActionState } from "react";
import { askTeacher, type QuestionState } from "@/actions/course-questions";

export type TeacherThread = {
  id: string;
  question: string;
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
};

/**
 * Its own card, deliberately NOT a tab inside the AI assistant.
 *
 * It started life in there and was unfindable: the card is titled "AI course
 * assistant" and collapsed behind a button reading "Ask AI about this course",
 * so a learner wanting a person would never open it. Asking your teacher is a
 * different act from asking the model, and it needs to look like one.
 *
 * Rendered only when the learner has a classroom teacher — see the learner page.
 */
export function AskTeacherPanel({ courseId, teacherName, threads }: {
  courseId: string;
  teacherName: string;
  threads: TeacherThread[];
}) {
  const [state, formAction, pending] = useActionState<QuestionState, FormData>(askTeacher, {});
  const waiting = threads.filter((thread) => !thread.answer).length;

  return <div className="card">
    <h2>Ask your teacher</h2>
    <p className="muted">Your teacher for this course is <strong>{teacherName}</strong>. A person answers these, so a reply is not instant.</p>
    <form action={formAction} className="form">
      <input type="hidden" name="courseId" value={courseId} />
      <label>Your question<textarea name="question" placeholder={`Ask ${teacherName} about this course...`} required /></label>
      <button disabled={pending}>{pending ? "Sending..." : "Send to teacher"}</button>
      {state.message && <p className={`message${state.ok ? "" : " error"}`}>{state.message}</p>}
    </form>
    {threads.length > 0 && <>
      <p className="muted">{waiting > 0 ? `${waiting} awaiting a reply.` : "All your questions have been answered."}</p>
      <div className="teacher-threads">
        {threads.map((thread) => <div className="teacher-thread" key={thread.id}>
          <p><b>You:</b> {thread.question}</p>
          {thread.answer
            ? <p><b>{teacherName}:</b> {thread.answer}</p>
            : <p className="muted">Waiting for your teacher to answer.</p>}
          <small className="muted">{thread.answeredAt ?? thread.createdAt}</small>
        </div>)}
      </div>
    </>}
  </div>;
}
