"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { submitAssessment, type AssessmentSubmitState } from "@/actions/assessments";

type Question = {
  id: string;
  order: number;
  questionText: string;
  options: { A: string; B: string; C: string; D: string };
  timeSeconds: number;
};

type Answer = { questionId: string; selectedOption: "A" | "B" | "C" | "D" | null; timeSpentSeconds: number };

export function AssessmentPlayer({ attemptId, questions }: { attemptId: string; questions: Question[] }) {
  const initialState: AssessmentSubmitState = {};
  const [state, formAction, pending] = useActionState(submitAssessment, initialState);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [remaining, setRemaining] = useState(questions[0]?.timeSeconds ?? 30);
  const startedAt = useRef(Date.now());
  const finished = answers.length >= questions.length;
  const question = questions[index];

  const answerJson = useMemo(() => JSON.stringify(answers), [answers]);

  useEffect(() => {
    if (!question || finished || state.scorePercent !== undefined) return;
    startedAt.current = Date.now();
    const interval = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          recordAnswer(null);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, question?.id]);

  function recordAnswer(selectedOption: "A" | "B" | "C" | "D" | null) {
    if (!question || answers.some((answer) => answer.questionId === question.id)) return;
    const elapsed = Math.max(0, Math.min(question.timeSeconds, Math.round((Date.now() - startedAt.current) / 1000)));
    const nextAnswers = [...answers, { questionId: question.id, selectedOption, timeSpentSeconds: elapsed || question.timeSeconds }];
    setAnswers(nextAnswers);
    if (index + 1 < questions.length) {
      setRemaining(questions[index + 1].timeSeconds);
      setIndex(index + 1);
    }
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
      <h2>Submit assessment</h2>
      <p>You answered {answers.filter((answer) => answer.selectedOption).length} of {questions.length} questions.</p>
      <form action={formAction} className="form">
        <input type="hidden" name="attemptId" value={attemptId} />
        <input type="hidden" name="answers" value={answerJson} />
        {state.message && <p className="message error">{state.message}</p>}
        <button disabled={pending}>{pending ? "Submitting..." : "Submit final answers"}</button>
      </form>
    </div>;
  }

  const timerPercent = Math.max(0, Math.min(100, remaining / question.timeSeconds * 100));
  return <div className="assessment-shell">
    <section className="card">
      <div className="assessment-top">
        <span className="badge">Question {index + 1} of {questions.length}</span>
        <div className="timer-pill"><span style={{ width: `${timerPercent}%` }} />{remaining}s</div>
      </div>
      <h1>{question.questionText}</h1>
      <div className="assessment-options">
        {(["A", "B", "C", "D"] as const).map((option) => <button className="option-card" key={option} onClick={() => recordAnswer(option)}>
          <strong>{option}</strong> {question.options[option]}
        </button>)}
      </div>
    </section>
    <aside className="card">
      <h2>Progress</h2>
      <div className="progress"><span style={{ width: `${answers.length / questions.length * 100}%` }} /></div>
      <p>{answers.length} of {questions.length} answered.</p>
      <p className="muted">The question locks automatically when time expires.</p>
    </aside>
  </div>;
}
