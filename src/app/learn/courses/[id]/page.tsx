import Link from "next/link";
import { notFound } from "next/navigation";
import { startAssessment } from "@/actions/assessments";
import { FeedbackResponseForm } from "@/components/feedback-response-form";
import { LessonPlayer } from "@/components/lesson-player";
import { certificateEligibility } from "@/lib/certificate-eligibility";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export default async function LearnCourse({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!user.employeeId) notFound();
  const enrollment = await db.enrollment.findUnique({
    where: { employeeId_courseId: { employeeId: user.employeeId, courseId: id } },
    include: {
      progress: true,
      course: {
        include: {
          contents: {
            where: { isPublished: true },
            include: { lessons: { where: { approvedAt: { not: null } }, orderBy: { order: "asc" } } },
            orderBy: { version: "asc" },
          },
          assessments: {
            where: { status: "ACTIVE" },
            include: { questions: true, attempts: { where: { employeeId: user.employeeId, status: "SUBMITTED" }, orderBy: [{ scorePercent: "desc" }, { timeTakenSeconds: "asc" }], take: 1 } },
            take: 1,
          },
          feedbackForms: {
            where: { isActive: true },
            include: { questions: { orderBy: { order: "asc" } }, responses: { where: { employeeId: user.employeeId }, take: 1 } },
            take: 1,
          },
        },
      },
    },
  });
  if (!enrollment || enrollment.course.status !== "PUBLISHED") notFound();

  const progress = new Map(enrollment.progress.map((item) => [item.lessonId, item]));
  const lessons = enrollment.course.contents.flatMap((content) => content.lessons.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    type: lesson.type,
    pageAssetKeys: Array.isArray(lesson.pageAssetKeys) ? lesson.pageAssetKeys as string[] : [],
    pageCount: lesson.pageCount,
    videoKey: lesson.type === "VIDEO" ? content.storedKey : undefined,
    watchedSeconds: progress.get(lesson.id)?.watchedSeconds ?? 0,
    viewedPages: Array.isArray(progress.get(lesson.id)?.viewedPages) ? progress.get(lesson.id)!.viewedPages as number[] : [],
    completed: Boolean(progress.get(lesson.id)?.completedAt),
  })));
  const completed = lessons.filter((lesson) => lesson.completed).length;
  const percent = lessons.length ? Math.round(completed / lessons.length * 100) : 0;
  const assessment = enrollment.course.assessments[0];
  const bestAttempt = assessment?.attempts[0];
  const feedbackForm = enrollment.course.feedbackForms[0];
  const feedbackSubmitted = Boolean(feedbackForm?.responses.length);
  const certificate = certificateEligibility({
    certificateEnabled: enrollment.course.certificateEnabled,
    totalLessons: lessons.length,
    completedLessons: completed,
    courseCompleted: Boolean(enrollment.completedAt),
    hasActiveAssessment: Boolean(assessment),
    hasPassedAssessment: Boolean(bestAttempt?.passed),
    hasActiveFeedbackForm: Boolean(feedbackForm),
    hasSubmittedFeedback: feedbackSubmitted,
  });

  return <main className="container learn-container">
    <div className="badge-row"><span className="badge">{enrollment.status.replaceAll("_", " ")}</span>{!enrollment.course.isActive && <span className="badge badge-muted">Inactive</span>}</div>
    <h1>{enrollment.course.title}</h1>
    {!enrollment.course.isActive && <p className="message">This course is inactive for new enrolments, but remains available to you because you are already enrolled.</p>}
    <div className="progress"><span style={{ width: `${percent}%` }} /></div>
    <p>{completed} of {lessons.length} lessons complete</p>

    <div className="learning-shell">
      <section className="learning-main">
        <LessonPlayer lessons={lessons} />
      </section>
      <aside className="learning-sidebar">
        {assessment && <div className="card">
          <h2>MCQ assessment</h2>
          <p>{assessment.title}</p>
          <p className="muted">{assessment.questions.length} questions - pass mark {assessment.passPercentage}%</p>
          {bestAttempt ? <p><span className="badge">{bestAttempt.passed ? "Passed" : "Submitted"}</span> Best score: {bestAttempt.scorePercent}%</p> : <p className="muted">No submitted attempts yet.</p>}
          <form action={startAssessment}>
            <input type="hidden" name="courseId" value={enrollment.courseId} />
            <button>{bestAttempt ? "Retake assessment" : "Start assessment"}</button>
          </form>
        </div>}

        <div className="card">
          <h2>Certificate</h2>
          {certificate.ready ? <>
            <p>You are eligible for the course certificate.</p>
            <Link className="button secondary" href={`/learn/courses/${id}/certificate`}>View certificate</Link>
          </> : <>
            <p className="muted">Certificate will be available after these requirements are complete:</p>
            <ul className="requirement-list">
              {certificate.missing.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </>}
        </div>

        {feedbackForm && enrollment.completedAt && <FeedbackResponseForm
          courseId={id}
          formId={feedbackForm.id}
          alreadySubmitted={feedbackForm.responses.length > 0}
          questions={feedbackForm.questions.map((question) => ({
            id: question.id,
            questionText: question.questionText,
            type: question.type,
            required: question.required,
            options: Array.isArray(question.options) ? question.options.map(String) : [],
          }))}
        />}
      </aside>
    </div>
  </main>;
}
