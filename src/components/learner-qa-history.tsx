"use client";

import { useId, useState } from "react";
import { LearnerAiHistory } from "@/components/learner-ai-history";
import { withBase } from "@/lib/base-path";
import type { AiHistoryLearner } from "@/lib/ai-history";
import type { TeacherQaItem, TeacherQaLearner } from "@/lib/teacher-qa";

type Loaded = { items: TeacherQaItem[]; total: number };

/** One learner's questions to their teacher, loaded when picked. */
function LearnerTeacherQa({ courseId, learners }: { courseId: string; learners: TeacherQaLearner[] }) {
  const selectId = useId();
  const [employeeId, setEmployeeId] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");

  async function choose(next: string) {
    setEmployeeId(next);
    setLoaded(null);
    if (!next) { setState("idle"); return; }
    setState("loading");
    try {
      const response = await fetch(withBase(`/api/courses/${courseId}/teacher-qa/learner?employeeId=${encodeURIComponent(next)}`));
      if (!response.ok) throw new Error(String(response.status));
      setLoaded(await response.json() as Loaded);
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  if (!learners.length) return <p className="muted">No learner has asked the teacher anything yet.</p>;
  return <div className="ai-history">
    <label htmlFor={selectId}>Learner
      <select id={selectId} value={employeeId} onChange={(event) => void choose(event.target.value)}>
        <option value="">Choose a learner ({learners.length} have asked)</option>
        {learners.map((learner) => <option key={learner.employeeId} value={learner.employeeId}>
          {learner.name} ({learner.employeeCode}) - {learner.count} question{learner.count === 1 ? "" : "s"}{learner.unanswered ? `, ${learner.unanswered} waiting` : ""}
        </option>)}
      </select>
    </label>
    {state === "loading" && <p className="muted">Loading…</p>}
    {state === "failed" && <p className="error">That learner&apos;s questions could not be loaded. Please try again.</p>}
    {loaded && <ol className="ai-history-list">
      {loaded.items.map((item) => <li key={item.id}>
        <p><strong>{item.question}</strong></p>
        <p>{item.answer ?? <span className="muted">Waiting for the teacher&apos;s answer.</span>}</p>
        <small className="muted">Asked {item.asked}{item.answered ? ` · Answered ${item.answered}` : ""}</small>
      </li>)}
    </ol>}
  </div>;
}

/**
 * Learner Q&A history, in two tabs: what learners asked the AI assistant, and
 * what they asked their teacher. Each tab has its own picker and its own Excel
 * download of everything for the course.
 */
export function LearnerQaHistory({ courseId, aiLearners, teacherLearners }: { courseId: string; aiLearners: AiHistoryLearner[]; teacherLearners: TeacherQaLearner[] }) {
  const [tab, setTab] = useState<"ai" | "teacher">("ai");
  return <div>
    <div className="chips" role="tablist" aria-label="Q&A history">
      <button type="button" role="tab" aria-selected={tab === "ai"} className={`chip${tab === "ai" ? " chip-active" : ""}`} onClick={() => setTab("ai")}>AI assistant <span>{aiLearners.length}</span></button>
      <button type="button" role="tab" aria-selected={tab === "teacher"} className={`chip${tab === "teacher" ? " chip-active" : ""}`} onClick={() => setTab("teacher")}>Teacher <span>{teacherLearners.length}</span></button>
    </div>
    {tab === "ai"
      ? <>
        <p className="muted">Pick a learner to see what they asked the AI assistant in this course.</p>
        <p><a className="button secondary" href={withBase(`/api/courses/${courseId}/ai-history`)}>Download complete AI history Excel</a></p>
        <LearnerAiHistory courseId={courseId} learners={aiLearners} />
      </>
      : <>
        <p className="muted">Pick a learner to see what they asked their teacher, and the answers.</p>
        <p><a className="button secondary" href={withBase(`/api/courses/${courseId}/teacher-qa`)}>Download complete Q&amp;A with Teacher Excel</a></p>
        <LearnerTeacherQa courseId={courseId} learners={teacherLearners} />
      </>}
  </div>;
}
