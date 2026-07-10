"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { submitAssessment, type AssessmentSubmitState } from "@/actions/assessments";

type Question = {
  id: string;
  order: number;
  questionText: string;
  options: { A: string; B: string; C: string; D: string };
};

type Answer = { questionId: string; selectedOption: "A" | "B" | "C" | "D" | null; timeSpentSeconds: number };

export function AssessmentPlayer({ attemptId, questions, timeLimitSeconds }: { attemptId: string; questions: Question[]; timeLimitSeconds: number }) {
  const initialState: AssessmentSubmitState = {};
  const [state, formAction, pending] = useActionState(submitAssessment, initialState);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<string, "A" | "B" | "C" | "D">>({});
  const [finished, setFinished] = useState(false);
  const [expired, setExpired] = useState(false);
  const [remaining, setRemaining] = useState(timeLimitSeconds);
  const submitForm = useRef<HTMLFormElement>(null);
  const question = questions[index];
  const answers = useMemo<Answer[]>(() => questions.map((item) => ({
    questionId: item.id,
    selectedOption: selected[item.id] ?? null,
    timeSpentSeconds: 0,
  })), [questions, selected]);
  const answerJson = useMemo(() => JSON.stringify(answers), [answers]);
  const answeredCount = answers.filter((answer) => answer.selectedOption).length;

  useEffect(() => {
    if (!questions.length || finished || state.scorePercent !== undefined) return;
    const interval = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          setExpired(true);
          setFinished(true);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [finished, questions.length, state.scorePercent]);

  useEffect(() => {
    if (expired && finished && submitForm.current && state.scorePercent === undefined) {
      submitForm.current.requestSubmit();
    }
  }, [expired, finished, state.scorePercent]);

  function recordAnswer(selectedOption: "A" | "B" | "C" | "D") {
    if (!question || finished) return;
    setSelected((current) => ({ ...current, [question.id]: selectedOption }));
  }

  function finishAssessment() {
    setFinished(true);
  }

  if (!questions.length) return <div className="card">No assessment questions are available.</div>;

  if (state.scorePercent !== undefined) {
    return <div className="card assessment-result">
      <h2>{state.passed ? "Assessment passed" : "Assessment submitted"}</h2>
      <div className="stat">{state.scorePercent}%</div>
      <p>{state.message}</p>
      <a className="button secondary" href="../">Back to course</a>
    </div>;
  }

  if (finished) {
    return <div className="card assessment-result">
      <h2>{expired ? "Time expired" : "Submit assessment"}</h2>
      <p>You answered {answeredCount} of {questions.length} questions.</p>
      <form ref={submitForm} action={formAction} className="form">
        <input type="hidden" name="attemptId" value={attemptId} />
        <input type="hidden" name="answers" value={answerJson} />
        {state.message && <p className="message error">{state.message}</p>}
        <button disabled={pending}>{pending ? "Submitting..." : "Submit final answers"}</button>
      </form>
    </div>;
  }

  const timerPercent = Math.max(0, Math.min(100, remaining / timeLimitSeconds * 100));
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");
  return <div className="assessment-shell">
    <section className="card">
      <div className="assessment-top">
        <span className="badge">Question {index + 1} of {questions.length}</span>
        <div className="timer-pill"><span style={{ width: `${timerPercent}%` }} />{minutes}:{seconds}</div>
      </div>
      <h1>{question.questionText}</h1>
      <div className="assessment-options">
        {(["A", "B", "C", "D"] as const).map((option) => <button className={`option-card ${selected[question.id] === option ? "option-selected" : ""}`} key={option} onClick={() => recordAnswer(option)}>
          <strong>{option}</strong> {question.options[option]}
        </button>)}
      </div>
      <div className="assessment-nav">
        <button className="secondary" disabled={index === 0} onClick={() => setIndex((current) => Math.max(0, current - 1))}>Previous</button>
        {index + 1 < questions.length
          ? <button onClick={() => setIndex((current) => Math.min(questions.length - 1, current + 1))}>Next</button>
          : <button onClick={finishAssessment}>Review and submit</button>}
      </div>
    </section>
    <aside className="card">
      <h2>Progress</h2>
      <div className="progress"><span style={{ width: `${answeredCount / questions.length * 100}%` }} /></div>
      <p>{answeredCount} of {questions.length} answered.</p>
      <p className="muted">The assessment submits automatically when the overall timer reaches zero.</p>
      <button className="secondary" onClick={finishAssessment}>Submit now</button>
    </aside>
  </div>;
}
