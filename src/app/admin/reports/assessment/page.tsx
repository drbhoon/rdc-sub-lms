import { UserRole } from "@prisma/client";
import Link from "next/link";
import { withBase } from "@/lib/base-path";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

function value(params: Record<string, string | string[] | undefined>, key: string) {
  const item = params[key];
  return Array.isArray(item) ? item[0] ?? "" : item ?? "";
}

export default async function AssessmentReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(UserRole.SUPER_ADMIN);
  const params = await searchParams;
  const courses = await db.course.findMany({
    where: { assessments: { some: {} } },
    select: { id: true, title: true, assessments: { select: { id: true, title: true, version: true }, orderBy: { version: "desc" } } },
    orderBy: { title: "asc" },
  });
  const selectedCourseId = value(params, "courseId") || courses[0]?.id || "";
  const selectedCourse = courses.find((course) => course.id === selectedCourseId);
  const selectedAssessmentId = value(params, "assessmentId") || selectedCourse?.assessments[0]?.id || "";
  const assessment = selectedAssessmentId ? await db.assessment.findFirst({
    where: { id: selectedAssessmentId, courseId: selectedCourseId },
    include: {
      course: true,
      questions: { orderBy: { order: "asc" } },
      attempts: {
        include: { employee: { include: { company: true } }, answers: { include: { question: true } } },
        orderBy: [{ startedAt: "desc" }],
      },
    },
  }) : null;

  const submitted = assessment?.attempts.filter((attempt) => attempt.status === "SUBMITTED") ?? [];
  const latestByLearner = new Map<string, (typeof submitted)[number]>();
  for (const attempt of submitted) {
    const current = latestByLearner.get(attempt.employeeId);
    if (!current || attempt.attemptNumber > current.attemptNumber) latestByLearner.set(attempt.employeeId, attempt);
  }
  const latest = [...latestByLearner.values()];
  const passRate = latest.length ? Math.round(latest.filter((attempt) => attempt.passed).length / latest.length * 100) : 0;
  const averageScore = latest.length ? Math.round(latest.reduce((sum, attempt) => sum + attempt.scorePercent, 0) / latest.length * 10) / 10 : 0;
  const timeline = assessment ? assessment.attempts.flatMap((attempt) => {
    const user = `${attempt.employee.name} (${attempt.employee.employeeCode})`;
    const events = [{ type: "Started", user, description: `Attempt ${attempt.attemptNumber}`, date: attempt.startedAt }];
    for (const answer of attempt.answers) events.push({ type: "Answer submitted", user, description: `Q${answer.question.order}: ${answer.selectedOption ?? "blank"} - ${answer.isCorrect ? "correct" : "incorrect"}`, date: answer.answeredAt });
    if (attempt.submittedAt) events.push({ type: "Submitted", user, description: `${attempt.scorePercent}% - ${attempt.passed ? "passed" : "not passed"}`, date: attempt.submittedAt });
    return events;
  }).sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 500) : [];

  return <main className="container">
    <h1>Assessment reports</h1>
    <nav className="report-tabs" aria-label="Report sections"><Link href="/admin/reports">General</Link><Link className="active" href="/admin/reports/assessment">Assessment</Link><Link href="/admin/reports/feedback">Feedback</Link></nav>
    <form className="period-filter card" method="get">
      <label>Course<select name="courseId" defaultValue={selectedCourseId}>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
      <label>Assessment version<select name="assessmentId" defaultValue={selectedAssessmentId}>{selectedCourse?.assessments.map((item) => <option key={item.id} value={item.id}>v{item.version} - {item.title}</option>)}</select></label>
      <button>Apply</button>
      {assessment && <a className="button secondary" href={withBase(`/api/courses/${assessment.courseId}/assessment-results?assessmentId=${assessment.id}`)}>Download Overview, Details & Timeline Excel</a>}
    </form>
    {!assessment ? <div className="card"><p>No assessment is available.</p></div> : <>
      <div className="grid">
        <div className="card"><div className="stat">{latest.length}</div><p>Learners in latest-attempt summary</p></div>
        <div className="card"><div className="stat">{submitted.length}</div><p>All submitted attempts</p></div>
        <div className="card"><div className="stat">{averageScore}%</div><p>Average latest score</p></div>
        <div className="card"><div className="stat">{passRate}%</div><p>Latest-attempt pass rate</p></div>
      </div>
      <section className="card dashboard-row"><h2>Overview: question performance</h2><p className="muted">Calculated from each learner&apos;s latest submitted attempt.</p><div className="table-wrap"><table><thead><tr><th>Question</th><th>Text</th><th>Answered</th><th>Correct</th><th>Correct %</th><th>A</th><th>B</th><th>C</th><th>D</th><th>Answer</th></tr></thead><tbody>
        {assessment.questions.map((question) => {
          const answers = latest.flatMap((attempt) => attempt.answers.filter((answer) => answer.questionId === question.id));
          const count = (option: string) => answers.filter((answer) => answer.selectedOption === option).length;
          const distribution = (option: string) => `${count(option)} (${answers.length ? Math.round(count(option) / answers.length * 100) : 0}%)`;
          const correct = answers.filter((answer) => answer.isCorrect).length;
          return <tr key={question.id}><td>Q{question.order}</td><td>{question.questionText}</td><td>{answers.length}</td><td>{correct}</td><td>{answers.length ? Math.round(correct / answers.length * 100) : 0}%</td><td>{distribution("A")}</td><td>{distribution("B")}</td><td>{distribution("C")}</td><td>{distribution("D")}</td><td>{question.correctOption}</td></tr>;
        })}
      </tbody></table></div></section>
      <section className="card"><h2>Individual responses: all attempts</h2><div className="table-wrap"><table><thead><tr><th>Learner</th><th>Company</th><th>Attempt</th><th>Score</th><th>Correct</th><th>Status</th><th>Started</th><th>Submitted</th>{assessment.questions.map((question) => <th key={question.id}>Q{question.order}</th>)}</tr></thead><tbody>
        {submitted.map((attempt) => { const answerMap = new Map(attempt.answers.map((answer) => [answer.questionId, answer])); return <tr key={attempt.id}><td>{attempt.employee.name}<br /><span className="muted">{attempt.employee.employeeCode}</span></td><td>{attempt.employee.company.name}</td><td>{attempt.attemptNumber}</td><td>{attempt.scorePercent}%</td><td>{attempt.correctAnswers}/{attempt.totalQuestions}</td><td>{attempt.passed ? "Passed" : "Not passed"}</td><td>{attempt.startedAt.toLocaleString("en-IN")}</td><td>{attempt.submittedAt?.toLocaleString("en-IN")}</td>{assessment.questions.map((question) => { const answer = answerMap.get(question.id); return <td className={answer ? answer.isCorrect ? "cell-correct" : "cell-incorrect" : ""} key={question.id}>{answer ? `${answer.selectedOption ?? "Blank"} · ${answer.isCorrect ? "Correct" : "Incorrect"}` : ""}</td>; })}</tr>; })}
        {!submitted.length && <tr><td colSpan={8 + assessment.questions.length}>No submitted attempts yet.</td></tr>}
      </tbody></table></div></section>
      <section className="card"><h2>Timeline</h2><div className="table-wrap"><table><thead><tr><th>Event</th><th>User</th><th>Description</th><th>Date</th></tr></thead><tbody>
        {timeline.map((event, index) => <tr key={`${event.date.toISOString()}-${index}`}><td>{event.type}</td><td>{event.user}</td><td>{event.description}</td><td>{event.date.toLocaleString("en-IN")}</td></tr>)}
        {!timeline.length && <tr><td colSpan={4}>No assessment activity yet.</td></tr>}
      </tbody></table></div></section>
    </>}
  </main>;
}
