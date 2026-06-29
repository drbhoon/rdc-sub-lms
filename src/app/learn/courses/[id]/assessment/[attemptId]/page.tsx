import { notFound } from "next/navigation";
import { AssessmentPlayer } from "@/components/assessment-player";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export default async function AssessmentAttemptPage({ params }: { params: Promise<{ id: string; attemptId: string }> }) {
  const user = await requireUser();
  const { id, attemptId } = await params;
  if (!user.employeeId) notFound();
  const attempt = await db.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: {
      assessment: { include: { course: true, questions: { orderBy: { order: "asc" } } } },
    },
  });
  if (!attempt || attempt.employeeId !== user.employeeId || attempt.assessment.courseId !== id || attempt.assessment.course.status !== "PUBLISHED") notFound();

  if (attempt.status === "SUBMITTED") {
    return <main className="container"><div className="card"><h1>Assessment submitted</h1><div className="stat">{attempt.scorePercent}%</div><p>{attempt.passed ? "Passed" : "Not passed"}</p><a className="button secondary" href={`/learn/courses/${id}`}>Back to course</a></div></main>;
  }

  return <main className="container">
    <span className="badge">MCQ Assessment</span>
    <h1>{attempt.assessment.title}</h1>
    <AssessmentPlayer
      attemptId={attempt.id}
      questions={attempt.assessment.questions.map((question) => ({
        id: question.id,
        order: question.order,
        questionText: question.questionText,
        options: { A: question.optionA, B: question.optionB, C: question.optionC, D: question.optionD },
        timeSeconds: question.timeSeconds,
      }))}
    />
  </main>;
}
