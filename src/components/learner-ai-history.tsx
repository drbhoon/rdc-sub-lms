"use client";

import { useId, useState } from "react";
import { withBase } from "@/lib/base-path";
import type { AiHistoryItem, AiHistoryLearner } from "@/lib/ai-history";

type Loaded = { items: AiHistoryItem[]; total: number };

/**
 * Learner AI history, one learner at a time.
 *
 * Everybody's latest questions in a single table made the course page run on
 * for screens. The list is now a dropdown of the learners who have used the
 * assistant, and the questions of the chosen one load when picked.
 */
export function LearnerAiHistory({ courseId, learners }: { courseId: string; learners: AiHistoryLearner[] }) {
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
      const response = await fetch(withBase(`/api/courses/${courseId}/ai-history/learner?employeeId=${encodeURIComponent(next)}`));
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as Loaded;
      setLoaded(body);
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  if (!learners.length) return <p className="muted">No learner AI history is available yet.</p>;
  return <div className="ai-history">
    <label htmlFor={selectId}>Learner
      <select id={selectId} value={employeeId} onChange={(event) => void choose(event.target.value)}>
        <option value="">Choose a learner ({learners.length} have asked)</option>
        {learners.map((learner) => <option key={learner.employeeId} value={learner.employeeId}>
          {learner.name} ({learner.employeeCode}) - {learner.count} question{learner.count === 1 ? "" : "s"}
        </option>)}
      </select>
    </label>
    {state === "loading" && <p className="muted">Loading…</p>}
    {state === "failed" && <p className="error">That learner&apos;s history could not be loaded. Please try again.</p>}
    {loaded && <>
      <p className="muted">
        {loaded.total > loaded.items.length ? `Latest ${loaded.items.length} of ${loaded.total} questions. The Excel download holds all of them.` : `${loaded.total} question${loaded.total === 1 ? "" : "s"}, newest first.`}
      </p>
      <ol className="ai-history-list">
        {loaded.items.map((item) => <li key={item.id}>
          <p><strong>{item.question}</strong></p>
          <p>{item.answer}</p>
          <small className="muted">{item.channel}{item.language ? ` · ${item.language.toUpperCase()}` : ""} · {item.asked}</small>
        </li>)}
      </ol>
    </>}
  </div>;
}
