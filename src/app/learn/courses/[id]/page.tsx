import Link from "next/link";
import { notFound } from "next/navigation";
import { startAssessment } from "@/actions/assessments";
import { CourseAiAssistant } from "@/components/course-ai-assistant";
import { FeedbackResponseForm } from "@/components/feedback-response-form";
import { LessonPlayer } from "@/components/lesson-player";
import { certificateEligibility } from "@/lib/certificate-eligibility";
import { withBase } from "@/lib/base-path";
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
          // Every ACTIVE assessment, not one — a quiz belongs to a module now,
          // so a course can have several running together (one per module).
          assessments: {
            where: { status: "ACTIVE" },
            include: {
              questions: true,
              courseContent: { include: { lessons: true } },
              attempts: { where: { employeeId: user.employeeId, status: "SUBMITTED" }, orderBy: [{ scorePercent: "desc" }, { timeTakenSeconds: "asc" }], take: 1 },
            },
          },
          feedbackForms: {
            where: { isActive: true },
            // Every response of THIS learner's, not just one — feedback is
            // per module now, so "already submitted" has to be answered
            // separately for each module rather than once for the form.
            include: { questions: { orderBy: { order: "asc" } }, responses: { where: { employeeId: user.employeeId } } },
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

  // One quiz card per module that has one, not one card for the whole
  // course. Only the modules a teacher actually put a quiz on are required
  // for the certificate — a course with 5 modules and 2 quizzes is not
  // blocked on the 3 that were never meant to have one.
  const assessmentModules = enrollment.course.assessments.map((assessment) => ({
    assessment,
    bestAttempt: assessment.attempts[0],
    title: assessment.courseContent?.lessons[0]?.title ?? "Whole course",
  }));
  const hasActiveAssessment = assessmentModules.length > 0;
  const hasPassedAssessment = hasActiveAssessment && assessmentModules.every((module) => module.bestAttempt?.passed);

  const feedbackForm = enrollment.course.feedbackForms[0];

  // One feedback opportunity per module, not one for the whole course. A
  // module is open for feedback once its (single) lesson is complete, and
  // "submitted" is tracked per module via the response's courseContentId.
  const respondedContentIds = new Set((feedbackForm?.responses ?? []).map((response) => response.courseContentId));
  const feedbackModules = enrollment.course.contents
    .filter((content) => content.lessons.length && content.lessons.every((lesson) => progress.get(lesson.id)?.completedAt))
    .map((content) => ({
      courseContentId: content.id,
      // The lesson carries the title a learner actually recognises ("Week 2
      // — Safety Protocols"); the content's own originalName is a filename.
      title: content.lessons[0]?.title ?? content.originalName,
      alreadySubmitted: respondedContentIds.has(content.id),
    }));
  // Required for every PUBLISHED module, not only the ones open for feedback
  // right now — by the time all lessons are complete (which certificate
  // eligibility already demands) the two sets are the same course.
  const publishedContentIds = enrollment.course.contents.map((content) => content.id);
  const feedbackSubmitted = Boolean(feedbackForm) && publishedContentIds.length > 0
    && publishedContentIds.every((contentId) => respondedContentIds.has(contentId));
  const certificate = certificateEligibility({
    certificateEnabled: enrollment.course.certificateEnabled,
    totalLessons: lessons.length,
    completedLessons: completed,
    courseCompleted: Boolean(enrollment.completedAt),
    hasActiveAssessment,
    hasPassedAssessment,
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
        {/* One card per module quiz — a course with several modules has
            several independent MCQ tests now, not one for the whole course. */}
        {assessmentModules.map(({ assessment, bestAttempt, title }) => <div className="card" key={assessment.id}>
          <h2>MCQ assessment — {title}</h2>
          <p>{assessment.title}</p>
          <p className="muted">{assessment.questionsPerAttempt ?? assessment.questions.length} random questions from a bank of {assessment.questions.length} - pass mark {assessment.passPercentage}%</p>
          {bestAttempt ? <p><span className="badge">{bestAttempt.passed ? "Passed" : "Submitted"}</span> Best score: {bestAttempt.scorePercent}%</p> : <p className="muted">No submitted attempts yet.</p>}
          <form action={startAssessment}>
            <input type="hidden" name="assessmentId" value={assessment.id} />
            <button>{bestAttempt ? "Retake assessment" : "Start assessment"}</button>
          </form>
        </div>)}

        <CourseAiAssistant courseId={id} />

        <div className="card">
          <h2>Certificate</h2>
          {certificate.ready ? <>
            <p>You are eligible for the course certificate.</p>
            <div className="button-row">
              <Link className="button secondary" href={`/learn/courses/${id}/certificate`}>View certificate</Link>
              <a className="button" href={withBase(`/api/courses/${id}/certificate`)}>Download PDF</a>
            </div>
          </> : <>
            <p className="muted">Certificate will be available after these requirements are complete:</p>
            <ul className="requirement-list">
              {certificate.missing.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </>}
        </div>

        {/* One form per module completed so far — a course finished over
            several sessions gets feedback recorded as each part is done,
            rather than one form waiting for every module together. */}
        {feedbackForm && feedbackModules.map((module) => <FeedbackResponseForm
          key={module.courseContentId}
          courseId={id}
          formId={feedbackForm.id}
          courseContentId={module.courseContentId}
          moduleTitle={module.title}
          alreadySubmitted={module.alreadySubmitted}
          questions={feedbackForm.questions.map((question) => ({
            id: question.id,
            questionText: question.questionText,
            type: question.type,
            required: question.required,
            options: Array.isArray(question.options) ? question.options.map(String) : [],
          }))}
        />)}
      </aside>
    </div>
  </main>;
}
