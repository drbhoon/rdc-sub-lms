"use client";

import { FeedbackQuestionType } from "@prisma/client";
import { useActionState } from "react";
import { submitFeedback, type FeedbackSubmitState } from "@/actions/feedback";

type Question = {
  id: string;
  questionText: string;
  type: FeedbackQuestionType;
  required: boolean;
  options: string[];
};

export function FeedbackResponseForm({ courseId, formId, questions, alreadySubmitted }: { courseId: string; formId: string; questions: Question[]; alreadySubmitted: boolean }) {
  const initialState: FeedbackSubmitState = {};
  const [state, action, pending] = useActionState(submitFeedback, initialState);

  if (state.ok) return <div className="card"><h2>Feedback submitted</h2><p>{state.message}</p></div>;

  return <form action={action} className="form card">
    <input type="hidden" name="courseId" value={courseId} />
    <input type="hidden" name="formId" value={formId} />
    <h2>{alreadySubmitted ? "Update feedback" : "Course feedback"}</h2>
    <p className="muted">Please answer the feedback questions below. Required questions are marked.</p>
    {questions.map((question) => <fieldset key={question.id} className="feedback-question">
      <legend>{question.questionText}{question.required ? " *" : ""}</legend>
      {question.type === FeedbackQuestionType.RATING_1_5 && <div className="rating-row">{[1, 2, 3, 4, 5].map((rating) => <label className="checkbox" key={rating}><input type="radio" name={`question_${question.id}`} value={rating} required={question.required} />{rating}</label>)}</div>}
      {question.type === FeedbackQuestionType.SHORT_TEXT && <input name={`question_${question.id}`} required={question.required} />}
      {question.type === FeedbackQuestionType.LONG_TEXT && <textarea name={`question_${question.id}`} required={question.required} />}
      {question.type === FeedbackQuestionType.YES_NO && <div className="form-row"><label className="checkbox"><input type="radio" name={`question_${question.id}`} value="YES" required={question.required} />Yes</label><label className="checkbox"><input type="radio" name={`question_${question.id}`} value="NO" required={question.required} />No</label></div>}
      {question.type === FeedbackQuestionType.SINGLE_CHOICE && question.options.map((option) => <label className="checkbox" key={option}><input type="radio" name={`question_${question.id}`} value={option} required={question.required} />{option}</label>)}
      {question.type === FeedbackQuestionType.MULTI_CHOICE && question.options.map((option) => <label className="checkbox" key={option}><input type="checkbox" name={`question_${question.id}`} value={option} />{option}</label>)}
    </fieldset>)}
    {state.message && <p className={`message ${state.ok ? "" : "error"}`}>{state.message}</p>}
    <button disabled={pending}>{pending ? "Submitting..." : alreadySubmitted ? "Update feedback" : "Submit feedback"}</button>
  </form>;
}
