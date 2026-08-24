import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { audit } from "@/lib/audit";
import { withBase } from "@/lib/base-path";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

function answerText(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join("; ");
  return String(value ?? "");
}

export default async function LearnerActivityPage({ params }: { params: Promise<{ employeeId: string }> }) {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const { employeeId } = await params;
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: {
      company: true,
      enrollments: {
        include: { course: true, progress: { include: { lesson: true }, orderBy: { updatedAt: "desc" } } },
        orderBy: { enrolledAt: "desc" },
      },
      assessmentAttempts: {
        include: { assessment: { include: { course: true } }, answers: { include: { question: true } } },
        orderBy: { startedAt: "desc" },
      },
      feedbackResponses: {
        // courseContent + its lesson, so each response can say WHICH module
        // it is about -- with feedback answered per module, a learner who
        // finished three modules of one course now has three rows here, and
        // without this they would look like unexplained duplicates.
        include: { form: { include: { course: true } }, courseContent: { include: { lessons: true } }, answers: { include: { question: true } } },
        orderBy: { submittedAt: "desc" },
      },
      aiInteractions: { include: { course: true }, orderBy: { createdAt: "desc" }, take: 1000 },
    },
  });
  if (!employee) notFound();
  await audit(actor.id, "LEARNER_ACTIVITY_VIEWED", "Employee", employee.id, { employeeCode: employee.employeeCode });

  return <main className="container">
    <div className="view-only-banner"><strong>View-only learner activity</strong><span>You are viewing recorded activity as an administrator. No learner data can be changed from this page.</span></div>
    <p><a className="button secondary" href={withBase("/admin/employees")}>Back to employees</a></p>
    <h1>{employee.name}</h1>
    <p>{employee.employeeCode} · {employee.email} · {employee.company.name} · {employee.designation}</p>
    <div className="grid">
      <div className="card"><div className="stat">{employee.enrollments.length}</div><p>Course enrolments</p></div>
      <div className="card"><div className="stat">{employee.enrollments.filter((item) => item.status === "COMPLETED").length}</div><p>Courses completed</p></div>
      <div className="card"><div className="stat">{employee.assessmentAttempts.filter((item) => item.status === "SUBMITTED").length}</div><p>Assessment attempts</p></div>
      <div className="card"><div className="stat">{employee.aiInteractions.length}</div><p>AI questions in retained history</p></div>
    </div>

    <section className="card dashboard-row"><h2>Courses and progress</h2><div className="table-wrap"><table><thead><tr><th>Course</th><th>Status</th><th>Enrolled</th><th>Started</th><th>Completed</th><th>Lessons touched</th><th>Lessons completed</th></tr></thead><tbody>
      {employee.enrollments.map((enrollment) => <tr key={enrollment.id}><td>{enrollment.course.title}</td><td>{enrollment.status.replaceAll("_", " ")}</td><td>{enrollment.enrolledAt.toLocaleString("en-IN")}</td><td>{enrollment.startedAt?.toLocaleString("en-IN") ?? ""}</td><td>{enrollment.completedAt?.toLocaleString("en-IN") ?? ""}</td><td>{enrollment.progress.length}</td><td>{enrollment.progress.filter((item) => item.completedAt).length}</td></tr>)}
      {!employee.enrollments.length && <tr><td colSpan={7}>No course enrolments.</td></tr>}
    </tbody></table></div></section>

    <section className="card"><h2>Lesson activity</h2><div className="table-wrap"><table><thead><tr><th>Course</th><th>Lesson</th><th>Pages viewed</th><th>Watched seconds</th><th>Completed</th><th>Last activity</th></tr></thead><tbody>
      {employee.enrollments.flatMap((enrollment) => enrollment.progress.map((progress) => <tr key={progress.id}><td>{enrollment.course.title}</td><td>{progress.lesson.title}</td><td>{Array.isArray(progress.viewedPages) ? progress.viewedPages.length : 0}</td><td>{progress.watchedSeconds}</td><td>{progress.completedAt ? "Yes" : "No"}</td><td>{progress.updatedAt.toLocaleString("en-IN")}</td></tr>))}
      {!employee.enrollments.some((enrollment) => enrollment.progress.length) && <tr><td colSpan={6}>No lesson activity.</td></tr>}
    </tbody></table></div></section>

    <section className="card"><h2>Assessment attempts</h2><div className="table-wrap"><table><thead><tr><th>Course</th><th>Assessment</th><th>Attempt</th><th>Status</th><th>Score</th><th>Correct</th><th>Answers</th><th>Started</th><th>Submitted</th></tr></thead><tbody>
      {employee.assessmentAttempts.map((attempt) => <tr key={attempt.id}><td>{attempt.assessment.course.title}</td><td>{attempt.assessment.title} v{attempt.assessment.version}</td><td>{attempt.attemptNumber}</td><td>{attempt.status.replaceAll("_", " ")}{attempt.status === "SUBMITTED" ? attempt.passed ? " · Passed" : " · Not passed" : ""}</td><td>{attempt.status === "SUBMITTED" ? `${attempt.scorePercent}%` : ""}</td><td>{attempt.status === "SUBMITTED" ? `${attempt.correctAnswers}/${attempt.totalQuestions}` : ""}</td><td>{attempt.answers.sort((a, b) => a.question.order - b.question.order).map((answer) => `Q${answer.question.order}: ${answer.selectedOption ?? "blank"} ${answer.isCorrect ? "✓" : "✗"}`).join("; ")}</td><td>{attempt.startedAt.toLocaleString("en-IN")}</td><td>{attempt.submittedAt?.toLocaleString("en-IN") ?? ""}</td></tr>)}
      {!employee.assessmentAttempts.length && <tr><td colSpan={9}>No assessment attempts.</td></tr>}
    </tbody></table></div></section>

    <section className="card"><h2>Feedback responses</h2>{employee.feedbackResponses.map((response) => <div className="activity-group" key={response.id}><h3>{response.form.course.title} · {response.courseContent?.lessons[0]?.title ?? "Whole course"} <span className="muted">({response.form.title} v{response.form.version})</span></h3><p className="muted">Submitted {response.submittedAt.toLocaleString("en-IN")}</p><ol>{response.answers.sort((a, b) => a.question.order - b.question.order).map((answer) => <li key={answer.id}><strong>{answer.question.questionText}</strong><br />{answerText(answer.value)}</li>)}</ol></div>)}{!employee.feedbackResponses.length && <p>No feedback submitted.</p>}</section>

    <section className="card"><h2>AI question and answer history</h2><div className="table-wrap"><table><thead><tr><th>Course</th><th>Mode</th><th>Language</th><th>Question</th><th>Answer / Status</th><th>Date</th></tr></thead><tbody>
      {employee.aiInteractions.map((item) => <tr key={item.id}><td>{item.course.title}</td><td>{item.channel}</td><td>{item.language?.toUpperCase() ?? ""}</td><td>{item.question}</td><td>{item.answer ?? item.error ?? item.status}</td><td>{item.createdAt.toLocaleString("en-IN")}</td></tr>)}
      {!employee.aiInteractions.length && <tr><td colSpan={6}>No AI history.</td></tr>}
    </tbody></table></div></section>
  </main>;
}
