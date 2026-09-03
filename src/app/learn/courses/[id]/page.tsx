import Link from "next/link";
import { notFound } from "next/navigation";
import { startAssessment } from "@/actions/assessments";
import { findLearnerTeacher } from "@/actions/course-questions";
import { AskTeacherPanel } from "@/components/ask-teacher-panel";
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
          // Every ACTIVE form, not one — a feedback form belongs to a module
          // now, same as an assessment does, so a course can have several
          // running together. courseContent + its lesson label which module;
          // responses are THIS learner's only, to know what they've answered.
          feedbackForms: {
            where: { isActive: true },
            include: {
              questions: { orderBy: { order: "asc" } },
              courseContent: { include: { lessons: true } },
              responses: { where: { employeeId: user.employeeId } },
            },
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

  // One feedback opportunity per module, not one for the whole course — same
  // "only what a teacher actually configured matters" rule as the quiz. Most
  // forms belong to one module now: one card, gated on that module's own
  // completion. A form uploaded before forms were module-scoped stays
  // whole-course (courseContentId null) and keeps its OLD behaviour — one
  // shared form, one card per completed module — so nothing already
  // collected under it is disturbed.
  const completedContentIds = new Set(
    enrollment.course.contents
      .filter((content) => content.lessons.length && content.lessons.every((lesson) => progress.get(lesson.id)?.completedAt))
      .map((content) => content.id),
  );
  const feedbackCards = enrollment.course.feedbackForms.flatMap((form) => {
    if (form.courseContentId) {
      if (!completedContentIds.has(form.courseContentId)) return [];
      return [{
        key: form.id,
        formId: form.id,
        courseContentId: form.courseContentId,
        title: form.courseContent?.lessons[0]?.title ?? "Module",
        alreadySubmitted: form.responses.some((response) => response.courseContentId === form.courseContentId),
      }];
    }
    const responded = new Set(form.responses.map((response) => response.courseContentId));
    return enrollment.course.contents.filter((content) => completedContentIds.has(content.id)).map((content) => ({
      key: `${form.id}:${content.id}`,
      formId: form.id,
      courseContentId: content.id,
      // The lesson carries the title a learner actually recognises ("Week 2
      // — Safety Protocols"); the content's own originalName is a filename.
      title: content.lessons[0]?.title ?? content.originalName,
      alreadySubmitted: responded.has(content.id),
    }));
  });

  // Required for every ACTIVE form — a module-scoped form needs its own
  // module's response; a legacy whole-course form still needs every
  // published module covered, exactly as it did before forms could be
  // scoped to one module.
  const publishedContentIds = enrollment.course.contents.map((content) => content.id);
  const hasActiveFeedbackForm = enrollment.course.feedbackForms.length > 0;
  const hasSubmittedFeedback = hasActiveFeedbackForm && enrollment.course.feedbackForms.every((form) => {
    if (form.courseContentId) return form.responses.some((response) => response.courseContentId === form.courseContentId);
    const responded = new Set(form.responses.map((response) => response.courseContentId));
    return publishedContentIds.length > 0 && publishedContentIds.every((contentId) => responded.has(contentId));
  });

  // Who this learner may ask, and what they have asked so far. Null teacher =
  // no classroom yet, and the Ask-your-teacher card is not rendered at all.
  const { teacher } = await findLearnerTeacher(user.employeeId, id);
  const teacherName = teacher ? (teacher.employee?.name ?? teacher.email) : null;
  const teacherThreads = (await db.courseQuestion.findMany({
    where: { courseId: id, employeeId: user.employeeId },
    orderBy: { createdAt: "desc" },
    take: 20,
  })).map((row) => ({
    id: row.id,
    question: row.question,
    answer: row.answer,
    createdAt: `Asked ${row.createdAt.toLocaleString("en-IN")}`,
    answeredAt: row.answeredAt ? `Answered ${row.answeredAt.toLocaleString("en-IN")}` : null,
  }));

  const certificate = certificateEligibility({
    certificateEnabled: enrollment.course.certificateEnabled,
    totalLessons: lessons.length,
    completedLessons: completed,
    courseCompleted: Boolean(enrollment.completedAt),
    hasActiveAssessment,
    hasPassedAssessment,
    hasActiveFeedbackForm,
    hasSubmittedFeedback,
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

        {teacherName && <AskTeacherPanel courseId={id} teacherName={teacherName} threads={teacherThreads} />}
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

        {/* One card per module completed so far — a course finished over
            several sessions gets feedback recorded as each part is done,
            rather than one form waiting for every module together. */}
        {feedbackCards.map((card) => {
          const form = enrollment.course.feedbackForms.find((f) => f.id === card.formId)!;
          return <FeedbackResponseForm
            key={card.key}
            courseId={id}
            formId={card.formId}
            courseContentId={card.courseContentId}
            moduleTitle={card.title}
            alreadySubmitted={card.alreadySubmitted}
            questions={form.questions.map((question) => ({
              id: question.id,
              questionText: question.questionText,
              type: question.type,
              required: question.required,
              options: Array.isArray(question.options) ? question.options.map(String) : [],
            }))}
          />;
        })}
      </aside>
    </div>
  </main>;
}
