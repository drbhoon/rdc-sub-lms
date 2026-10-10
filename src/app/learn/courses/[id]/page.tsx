import Link from "next/link";
import { startAssessment } from "@/actions/assessments";
import { loadCourseGrades } from "@/lib/course-grades";
import { findLearnerTeacher } from "@/actions/course-questions";
import { AskTeacherPanel } from "@/components/ask-teacher-panel";
import { CourseAiAssistant } from "@/components/course-ai-assistant";
import { FeedbackResponseForm } from "@/components/feedback-response-form";
import { LessonPlayer } from "@/components/lesson-player";
import { ModuleTabs, type ModuleTab } from "@/components/module-tabs";
import { certificateEligibility } from "@/lib/certificate-eligibility";
import { allFeedbackAnswered } from "@/lib/feedback-rules";
import { supersededQuizIds } from "@/lib/superseded-quizzes";
import { emptyAttempts, loadFinalAttempts, loadFinalSchedules, sittingForEnrollment } from "@/lib/final-schedule";
import type { FinalSitting } from "@/lib/final-sitting";
import { withBase } from "@/lib/base-path";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { formatIst } from "@/lib/ist";

function NotAvailable({ email }: { email: string }) {
  return <main className="narrow card">
    <h1>This course is not available to you</h1>
    <p>You are signed in as <strong>{email}</strong>. This course is not open to that account yet: either you are not enrolled in it, or it has not been published.</p>
    <p className="muted">If you were sent this link, sign out and sign in again with the e-mail address you were invited on, or ask your administrator to enrol you.</p>
    <div className="button-row"><Link className="button" href="/learn/courses">My courses</Link></div>
  </main>;
}

export default async function LearnCourse({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!user.employeeId) return <NotAvailable email={user.email} />;
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
  // An invite link opened with the wrong account, or before the course is
  // published, used to be a bare 404 that explained nothing.
  if (!enrollment || enrollment.course.status !== "PUBLISHED") return <NotAvailable email={user.email} />;

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
  //
  // In a one-module course an older module-less quiz is dropped once the module
  // has its own (see lib/superseded-quizzes.ts): it would be a second quiz on
  // the same single module, and the certificate check ignores it too.
  const superseded = supersededQuizIds(enrollment.course.assessments, enrollment.course.contents.length);
  const assessmentModules = enrollment.course.assessments.filter((assessment) => !superseded.has(assessment.id)).map((assessment) => ({
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
    // The final assessment's form is shown on the Final assessment tab instead.
    if (form.kind === "FINAL") return [];
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
  const hasSubmittedFeedback = allFeedbackAnswered(enrollment.course.feedbackForms, publishedContentIds);

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
    createdAt: `Asked ${formatIst(row.createdAt)}`,
    answeredAt: row.answeredAt ? `Answered ${formatIst(row.answeredAt)}` : null,
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

  // One tab per module, holding that module's quiz AND its feedback side by
  // side, below the course. They used to be cards stacked down the (sticky)
  // sidebar, which ran off the bottom of the screen once a course had a few
  // modules. A quiz
  // uploaded before quizzes were per module gets a "Whole course" tab.
  const feedbackFormFor = (contentId: string) => enrollment.course.feedbackForms.some((form) => form.kind !== "FINAL" && (!form.courseContentId || form.courseContentId === contentId));
  const quizPart = ({ assessment, bestAttempt }: (typeof assessmentModules)[number]) => <section key={assessment.id}>
    <h3>MCQ assessment</h3>
    <p><strong>{assessment.title}</strong></p>
    <p className="muted">{assessment.questionsPerAttempt ?? assessment.questions.length} random questions from a bank of {assessment.questions.length} · pass mark {assessment.passPercentage}%</p>
    {bestAttempt ? <p><span className="badge">{bestAttempt.passed ? "Passed" : "Not passed yet"}</span> Best score: {bestAttempt.scorePercent}%</p> : <p className="muted">No submitted attempts yet.</p>}
    <form action={startAssessment}>
      <input type="hidden" name="assessmentId" value={assessment.id} />
      <button>{bestAttempt ? "Retake assessment" : "Start assessment"}</button>
    </form>
  </section>;
  // A quiz uploaded before quizzes were per module belongs to no module. With
  // several modules it gets a "Whole course" tab of its own; with ONE there is
  // nothing to tell it apart from, so it is shown inside that module instead of
  // a second tab (and is still required for the certificate, as before).
  const wholeCourseQuizzes = assessmentModules.filter(({ assessment }) => !assessment.courseContentId && assessment.kind !== "FINAL");
  const singleModule = enrollment.course.contents.length === 1;
  const moduleTabs: ModuleTab[] = enrollment.course.contents.map((content, index) => {
    const quizzes = [
      ...assessmentModules.filter(({ assessment }) => assessment.courseContentId === content.id),
      ...(singleModule ? wholeCourseQuizzes : []),
    ];
    const feedback = feedbackCards.filter((card) => card.courseContentId === content.id);
    const hasFeedback = feedbackFormFor(content.id);
    const complete = completedContentIds.has(content.id);
    const done = quizzes.every((quiz) => quiz.bestAttempt?.passed) && (!hasFeedback || (feedback.length > 0 && feedback.every((card) => card.alreadySubmitted)));
    return {
      id: content.id,
      label: `Module ${index + 1}: ${content.lessons[0]?.title ?? content.originalName}`,
      status: done ? "done" as const : "todo" as const,
      show: quizzes.length > 0 || hasFeedback,
      panel: <div className="module-panel">
        {quizzes.map(quizPart)}
        {hasFeedback && <section>
          {feedback.map((card) => {
            const form = enrollment.course.feedbackForms.find((f) => f.id === card.formId)!;
            const questions = form.questions.map((question) => ({
              id: question.id,
              questionText: question.questionText,
              type: question.type,
              required: question.required,
              options: Array.isArray(question.options) ? question.options.map(String) : [],
            }));
            // Answered once. There is deliberately no way back into it: a
            // submitted response is final, so the form is not rendered again.
            return card.alreadySubmitted
              ? <p key={card.key}><span className="badge">Feedback submitted</span> Thank you.</p>
              : <FeedbackResponseForm embedded key={card.key} courseId={id} formId={card.formId}
                courseContentId={card.courseContentId} moduleTitle={card.title} questions={questions} />;
          })}
          {!complete && <><h3>Feedback</h3><p className="muted">Feedback for this module opens once you have completed all its lessons.</p></>}
        </section>}
      </div>,
    };
  }).filter((tab) => tab.show);
  const finalQuizzes = assessmentModules.filter(({ assessment }) => assessment.kind === "FINAL");
  if (wholeCourseQuizzes.length && !singleModule) {
    moduleTabs.push({
      id: "whole-course",
      label: "Whole course",
      status: wholeCourseQuizzes.every((quiz) => quiz.bestAttempt?.passed) ? "done" : "todo",
      panel: <div className="module-panel">{wholeCourseQuizzes.map(quizPart)}</div>,
    });
  }
  // The final does not open by itself: it opens when an admin schedules this
  // learner's classroom, and each learner has one attempt (an admin can allow
  // another). Whether they may start it is decided in lib/final-sitting, the
  // same place the Start button's server action asks.
  const finalAssessment = finalQuizzes[0]?.assessment ?? null;
  let finalState: FinalSitting | null = null;
  if (finalAssessment) {
    const [schedules, attempts] = await Promise.all([
      loadFinalSchedules(id),
      loadFinalAttempts(finalAssessment.id, finalAssessment.timeLimitSeconds, [user.employeeId]),
    ]);
    finalState = sittingForEnrollment(enrollment, schedules, attempts.get(user.employeeId) ?? emptyAttempts);
  }
  const finalPart = ({ assessment, bestAttempt }: (typeof assessmentModules)[number]) => <section key={assessment.id}>
    <h3>MCQ assessment</h3>
    <p><strong>{assessment.title}</strong></p>
    <p className="muted">{assessment.questionsPerAttempt ?? assessment.questions.length} random questions from a bank of {assessment.questions.length} · pass mark {assessment.passPercentage}% · {Math.round(assessment.timeLimitSeconds / 60)} minutes · one attempt</p>
    {bestAttempt && <p><span className="badge">{bestAttempt.passed ? "Passed" : "Not passed"}</span> Your score: {bestAttempt.scorePercent}%</p>}
    {finalState?.state === "NOT_SCHEDULED" && <p className="message">Your final assessment has not been scheduled yet. Your administrator will schedule it for your class, and it will open here at that time.</p>}
    {finalState?.state === "SCHEDULED" && <p className="message">Your final assessment opens on <strong>{formatIst(finalState.opensAt)}</strong>.</p>}
    {finalState?.state === "CLOSED" && <p className="message">The final assessment for your class closed on {formatIst(finalState.closedAt)}. If you could not take it, please contact your administrator.</p>}
    {finalState?.state === "USED" && <p className="message">You have used your attempt. If you need another, please ask your administrator.</p>}
    {(finalState?.state === "OPEN" || finalState?.state === "RESUME") && <>
      {finalState.state === "OPEN" && <p className="message">
        {finalState.closesAt ? <>Open until <strong>{formatIst(finalState.closesAt)}</strong>. </> : null}
        You have <strong>one attempt</strong>. It counts from the moment you start, even if you leave the page, and the timer keeps running.
      </p>}
      {finalState.state === "RESUME" && <p className="message">You have an attempt in progress. Carry on where you left off; the timer has kept running.</p>}
      <form action={startAssessment}>
        <input type="hidden" name="assessmentId" value={assessment.id} />
        <button>{finalState.state === "RESUME" ? "Resume final assessment" : "Start final assessment"}</button>
      </form>
    </>}
  </section>;
  // The final assessment draws on every module, so it comes last.
  if (finalQuizzes.length) {
    // Feedback on the final: offered once they have sat it, answered once.
    const finalForm = enrollment.course.feedbackForms.find((form) => form.kind === "FINAL") ?? null;
    const finalSat = finalQuizzes.some((quiz) => quiz.bestAttempt);
    const finalFeedbackDone = finalForm ? finalForm.responses.length > 0 : true;
    moduleTabs.push({
      id: "final",
      label: "Final assessment",
      status: finalQuizzes.every((quiz) => quiz.bestAttempt?.passed) && finalFeedbackDone ? "done" : "todo",
      panel: <div className="module-panel">
        <p className="muted">Questions are drawn at random from every module of this course.</p>
        {finalQuizzes.map(finalPart)}
        {finalForm && <section>
          {finalForm.responses.length > 0
            ? <p><span className="badge">Feedback submitted</span> Thank you.</p>
            : finalSat
              ? <FeedbackResponseForm embedded courseId={id} formId={finalForm.id} courseContentId="" moduleTitle="Final assessment"
                questions={finalForm.questions.map((question) => ({
                  id: question.id,
                  questionText: question.questionText,
                  type: question.type,
                  required: question.required,
                  options: Array.isArray(question.options) ? question.options.map(String) : [],
                }))} />
              : <><h3>Feedback</h3><p className="muted">Feedback on the final assessment opens once you have taken it.</p></>}
        </section>}
      </div>,
    });
  }
  // Open on the first module with something still to do.
  const firstOpenTab = moduleTabs.find((tab) => tab.status === "todo")?.id;

  // The weighted course result, when an admin has set the weights.
  const courseGrade = (await loadCourseGrades(id, [user.employeeId]))?.byEmployee.get(user.employeeId)?.grade ?? null;

  return <main className="container learn-container">
    <div className="badge-row"><span className="badge">{enrollment.status.replaceAll("_", " ")}</span>{!enrollment.course.isActive && <span className="badge badge-muted">Inactive</span>}</div>
    <h1>{enrollment.course.title}</h1>
    {!enrollment.course.isActive && <p className="message">This course is inactive for new enrolments, but remains available to you because you are already enrolled.</p>}
    <div className="progress"><span style={{ width: `${percent}%` }} /></div>
    <p>{completed} of {lessons.length} lessons complete</p>

    <div className="learning-shell">
      <section className="learning-main">
        <LessonPlayer lessons={lessons} moduleCount={enrollment.course.contents.length} />
      </section>
      <aside className="learning-sidebar">
        {teacherName && <AskTeacherPanel courseId={id} teacherName={teacherName} threads={teacherThreads} />}
        <CourseAiAssistant courseId={id} />

        {courseGrade && <div className="card course-result">
          <h2>Course result</h2>
          <p className="course-result-total"><strong>{courseGrade.total}</strong> / 100</p>
          <table className="course-result-table"><tbody>
            {courseGrade.components.map((component) => <tr key={component.key}>
              <td>{component.label}<br /><small className="muted">weight {component.weight}</small></td>
              <td>{component.score === null ? <span className="muted">not yet</span> : `${component.score}%`}</td>
              <td><strong>{component.contribution}</strong></td>
            </tr>)}
          </tbody></table>
          {!courseGrade.complete && <p className="muted">Still to come: {courseGrade.pending.join(", ")}. They add to this total as you complete them.</p>}
        </div>}

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

      </aside>
    </div>

    {/* Below the course: learners study first, then take the module's
        assessment and give its feedback. */}
    <div className="module-tabs-below">
      <ModuleTabs title="Assessments and feedback" intro="Choose a module to see its assessment and feedback." tabs={moduleTabs} initialId={firstOpenTab} />
    </div>
  </main>;
}
