import { withBase } from "@/lib/base-path";
import { notFound } from "next/navigation";
import { setAssessmentStatus, uploadAssessment } from "@/actions/assessments";
import { approveContent, editLesson, rejectContent, setCourseStatus } from "@/actions/courses";
import { setFeedbackFormActive, uploadFeedbackTemplate } from "@/actions/feedback";
import { ActionForm } from "@/components/action-form";
import { parseQuizQuestions } from "@/lib/ai-study-pack";
import { requireCourseManager } from "@/lib/course-access";
import { db } from "@/lib/db";
import { buildLeaderboardRows, formatDuration } from "@/lib/leaderboard";
import { classroomScope, enrollmentScopeWhere } from "@/lib/classroom-scope";

export default async function TeacherCourse({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireCourseManager(id);
  // A teacher who runs classrooms here sees only their own learners. One who
  // runs none still sees everybody — see classroom-scope for why that matters.
  const ownedClassrooms = await db.classroom.findMany({
    where: { courseId: id, teacherUserId: viewer.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const scope = classroomScope({ roles: viewer.roles.map((grant) => grant.role), ownedClassroomIds: ownedClassrooms.map((room) => room.id) });
  const course = await db.course.findUnique({
    where: { id },
    include: {
      contents: { include: { lessons: true }, orderBy: { version: "asc" } },
      enrollments: { where: enrollmentScopeWhere(scope), include: { employee: { include: { company: true } }, progress: true, classroom: { select: { name: true } } }, orderBy: { employee: { name: "asc" } } },
      // courseContent + its lesson, so this page can label which module a
      // quiz belongs to now that a course can have several active at once.
      assessments: { include: { questions: true, courseContent: { include: { lessons: true } }, attempts: { where: { status: "SUBMITTED" }, include: { employee: { include: { company: true } } } } }, orderBy: { version: "desc" } },
      // courseContent + its lesson, so the versions table can say WHICH
      // MODULE a form belongs to now that a course can have several active.
      feedbackForms: { include: { questions: true, courseContent: { include: { lessons: true } }, responses: true }, orderBy: { version: "desc" } },
      aiInteractions: { include: { employee: { include: { company: true } } }, orderBy: { createdAt: "desc" }, take: 25 },
    },
  });
  if (!course) notFound();
  const activeContents = course.contents.filter((content) => !content.rejectedAt);
  const canPublish = course.hasPendingChanges && activeContents.length > 0 && activeContents.every(
    (content) => content.processingStatus === "COMPLETED" && content.approvedAt && content.lessons.every((lesson) => lesson.approvedAt),
  );
  const totalLessons = course.contents
    .filter((content) => content.isPublished)
    .flatMap((content) => content.lessons.filter((lesson) => lesson.approvedAt))
    .length;
  const publishedModules = course.contents.filter((content) => content.isPublished && content.lessons.length);
  const activeFeedbackForms = course.feedbackForms.filter((form) => form.isActive);
  const archivedFeedbackForms = course.feedbackForms.filter((form) => !form.isActive);

  // A quiz belongs to a module now, so a course can have several ACTIVE at
  // once — combine each employee's best score across whichever of those they
  // attempted (excluding any a teacher marked out of the leaderboard) into
  // one averaged rank, same as the admin course page does.
  const leaderboardAssessments = course.assessments.filter((assessment) => assessment.status === "ACTIVE" && assessment.showLeaderboard);
  const combinedAssessmentByEmployee = new Map<string, {
    employee: (typeof course.assessments)[number]["attempts"][number]["employee"];
    scores: number[];
    totalSeconds: number;
    lastSubmittedAt: Date;
  }>();
  for (const assessment of leaderboardAssessments) {
    const bestPerEmployee = new Map<string, (typeof assessment.attempts)[number]>();
    for (const attempt of assessment.attempts) {
      const existing = bestPerEmployee.get(attempt.employeeId);
      if (!existing || attempt.scorePercent > existing.scorePercent || (attempt.scorePercent === existing.scorePercent && attempt.timeTakenSeconds < existing.timeTakenSeconds)) {
        bestPerEmployee.set(attempt.employeeId, attempt);
      }
    }
    for (const attempt of bestPerEmployee.values()) {
      const entry = combinedAssessmentByEmployee.get(attempt.employeeId)
        ?? { employee: attempt.employee, scores: [], totalSeconds: 0, lastSubmittedAt: attempt.submittedAt ?? attempt.startedAt };
      entry.scores.push(attempt.scorePercent);
      entry.totalSeconds += attempt.timeTakenSeconds;
      const submitted = attempt.submittedAt ?? attempt.startedAt;
      if (submitted > entry.lastSubmittedAt) entry.lastSubmittedAt = submitted;
      combinedAssessmentByEmployee.set(attempt.employeeId, entry);
    }
  }
  const progressLeaderboard = buildLeaderboardRows(course.enrollments.map((enrollment) => ({
    enrollmentId: enrollment.id,
    courseId: course.id,
    courseTitle: course.title,
    employeeCode: enrollment.employee.employeeCode,
    employeeName: enrollment.employee.name,
    companyName: enrollment.employee.company.name,
    enrolledAt: enrollment.enrolledAt,
    startedAt: enrollment.startedAt,
    completedAt: enrollment.completedAt,
    totalLessons,
    completedLessons: enrollment.progress.filter((progress) => progress.completedAt).length,
  })), 5);
  const assessmentLeaderboard = buildLeaderboardRows([...combinedAssessmentByEmployee.entries()].map(([employeeId, entry]) => ({
    enrollmentId: employeeId,
    courseId: course.id,
    courseTitle: course.title,
    employeeCode: entry.employee.employeeCode,
    employeeName: entry.employee.name,
    companyName: entry.employee.company.name,
    enrolledAt: entry.lastSubmittedAt,
    startedAt: entry.lastSubmittedAt,
    completedAt: entry.lastSubmittedAt,
    totalLessons: 100,
    completedLessons: 0,
    assessmentScorePercent: Math.round(entry.scores.reduce((sum, score) => sum + score, 0) / entry.scores.length * 10) / 10,
    completionSecondsOverride: entry.totalSeconds,
  })), 5);

  return <main className="container">
    <div className="badge-row"><span className="badge">{course.status.replaceAll("_", " ")}</span>{!course.isActive && <span className="badge badge-muted">Inactive</span>}</div>
    <h1>{course.title}</h1>
    <div className="two-col">
      <section className="form">
        <div className="card"><h2>Content approval</h2>
          {course.contents.map((content) => { const questions = parseQuizQuestions(content.quizQuestions); return <article className="card" key={content.id}>
            <h3>Version {content.version}: {content.originalName}</h3>
            <p><span className="badge">{content.processingStatus}</span> {content.isPublished && <span className="badge">LIVE</span>} {content.rejectedAt && <span className="badge">REJECTED</span>}</p>
            {content.summary && <><strong>{content.aiGeneratedAt ? "AI-generated summary" : "Extracted summary"}</strong><p>{content.summary}</p></>}
            {questions.length > 0 && <section className="ai-review">
              <h4>AI review questions and answers</h4>
              <p className="muted">Teacher review only · Generated with {content.aiModel ?? "OpenAI"}</p>
              <ol className="qa-list">{questions.map((question, index) => <li className="qa-card" key={`${content.id}-${index}`}>
                <strong>{question.question}</strong>
                <ol type="A">{question.options.map((option) => <li key={option}>{option}</li>)}</ol>
                <p className="answer"><strong>Answer:</strong> {question.correctAnswer}</p>
                <p><strong>Explanation:</strong> {question.explanation}</p>
              </li>)}</ol>
            </section>}
            {content.processingError && <p className="error">{content.processingError}</p>}
            {content.rejectionReason && <p className="error">Reason: {content.rejectionReason}</p>}
            {content.lessons.map((lesson) => <form action={editLesson} className="form card" key={lesson.id}>
              <input type="hidden" name="courseId" value={course.id}/><input type="hidden" name="lessonId" value={lesson.id}/>
              <label>Lesson title<input name="title" defaultValue={lesson.title} disabled={content.isPublished}/></label>
              <label>Summary<textarea name="summary" defaultValue={lesson.summary ?? ""} disabled={content.isPublished}/></label>
              {!content.isPublished && <button className="secondary">Save lesson changes</button>}
            </form>)}
            {content.processingStatus === "COMPLETED" && !content.approvedAt && !content.rejectedAt && <div className="form-row">
              <form action={approveContent}><input type="hidden" name="courseId" value={course.id}/><input type="hidden" name="contentId" value={content.id}/><button>Approve content</button></form>
              <form action={rejectContent} className="form"><input type="hidden" name="courseId" value={course.id}/><input type="hidden" name="contentId" value={content.id}/><label>Rejection reason<input name="reason" minLength={5} required/></label><button className="secondary">Reject</button></form>
            </div>}
            {content.approvedAt && <p className="success">Approved</p>}
          </article>; })}
        </div>
        {canPublish && <div className="card"><h2>{course.status === "PUBLISHED" ? "Publish approved changes" : "Publish course"}</h2><p>All current content is processed and approved.</p><form action={setCourseStatus}><input type="hidden" name="courseId" value={course.id}/><input type="hidden" name="status" value="PUBLISHED"/><button>{course.status === "PUBLISHED" ? "Publish changes" : "Publish to enrolled learners"}</button></form></div>}
      </section>
      <aside className="form"><div className="card"><h2>Learners</h2>{scope.scoped && <p className="message">Showing only your classroom{ownedClassrooms.length > 1 ? "s" : ""}: {ownedClassrooms.map((room) => room.name).join(", ")}.</p>}{course.hasPendingChanges && course.status === "PUBLISHED" && <p className="message">Learners continue seeing the current version until approved changes are published.</p>}{!course.isActive && <p className="message">This course is inactive for new enrolments, but enrolled learners can still see it.</p>}<div className="table-wrap"><table><thead><tr><th>Name</th><th>Classroom</th><th>Progress</th></tr></thead><tbody>
        {course.enrollments.map((enrollment) => <tr key={enrollment.id}><td>{enrollment.employee.name}<br/><small>{enrollment.employee.employeeCode}</small></td><td>{enrollment.classroom?.name ?? <span className="muted">Unassigned</span>}</td><td><span className="badge">{enrollment.status.replaceAll("_", " ")}</span></td></tr>)}
        {!course.enrollments.length && <tr><td colSpan={2}>No learners enrolled.</td></tr>}
      </tbody></table></div>{course.leaderboardEnabled && <section className="topper-panel"><h2>Toppers</h2><p className="muted">{assessmentLeaderboard.length ? "Formula: assessment score 70% + speed 30%. Assessment score is averaged across every quiz-eligible module attempted." : "Formula: progress score 70% + speed score 30%."}</p><ol className="leaderboard-list">{(assessmentLeaderboard.length ? assessmentLeaderboard : progressLeaderboard).map((row) => <li key={row.enrollmentId}><strong>{row.employeeName}</strong><span>{row.rankScore}% - {formatDuration(row.completionSeconds)}</span></li>)}</ol>{!(assessmentLeaderboard.length ? assessmentLeaderboard : progressLeaderboard).length && <p>No learner progress yet.</p>}</section>}</div>
        <div className="card"><h2>Learner AI history</h2><p className="muted">Latest learner questions asked in this course.</p><p><a className="button secondary" href={withBase(`/api/courses/${course.id}/ai-history`)}>Download complete AI history Excel</a></p><div className="table-wrap"><table><thead><tr><th>Learner</th><th>Mode</th><th>Question</th><th>Answer / Status</th></tr></thead><tbody>{course.aiInteractions.map((item) => <tr key={item.id}><td>{item.employee.name}<br/><small>{item.employee.employeeCode} - {item.employee.company.name}</small></td><td>{item.channel}{item.language ? ` · ${item.language.toUpperCase()}` : ""}</td><td>{item.question}</td><td>{item.answer ?? item.error ?? item.status}<br/><small>{item.createdAt.toLocaleString("en-IN")}</small></td></tr>)}{!course.aiInteractions.length && <tr><td colSpan={4}>No learner AI history is available yet.</td></tr>}</tbody></table></div></div>
        <div className="card"><h2>Assessment</h2><p><a className="button secondary" href={withBase("/api/templates/assessment")}>Download MCQ template</a></p>{publishedModules.length ? <ActionForm action={uploadAssessment} submitLabel="Upload and activate assessment"><input type="hidden" name="courseId" value={course.id}/><label>Module<select name="courseContentId" required>{publishedModules.map((content) => <option key={content.id} value={content.id}>{content.lessons[0]?.title ?? content.originalName}</option>)}</select></label><label>Assessment title<input name="title" defaultValue="Course Assessment" required/></label><label>Pass percentage<input name="passPercentage" type="number" min="1" max="100" defaultValue={course.passPercentage}/></label><label>Overall time limit (minutes)<input name="timeLimitMinutes" type="number" min="1" max="480" defaultValue={30}/></label><label>Questions offered per attempt<input name="questionsPerAttempt" type="number" min="1" max="200" defaultValue={20} required/></label><label>Question bank (up to 200 questions)<input type="file" name="file" accept=".csv,.xlsx,.xls" required/></label><label className="checkbox"><input type="checkbox" name="shuffleQuestions"/>Shuffle offered questions</label><label className="checkbox"><input type="checkbox" name="showLeaderboard" defaultChecked/>Show leaderboard</label></ActionForm> : <p className="muted">Publish a module with at least one lesson before uploading a quiz for it.</p>}<div className="table-wrap"><table><thead><tr><th>Version</th><th>Module</th><th>Status</th><th>Bank</th><th>Offered</th><th>Time</th><th>Shuffle</th><th>Action</th></tr></thead><tbody>{course.assessments.map((assessment) => <tr key={assessment.id}><td>v{assessment.version}</td><td>{assessment.courseContent?.lessons[0]?.title ?? "Whole course"}</td><td><span className="badge">{assessment.status}</span></td><td>{assessment.questions.length}</td><td>{assessment.questionsPerAttempt ?? assessment.questions.length}</td><td>{Math.ceil(assessment.timeLimitSeconds / 60)} min</td><td>{assessment.shuffleQuestions ? "YES" : "NO"}</td><td><form action={setAssessmentStatus}><input type="hidden" name="assessmentId" value={assessment.id}/><input type="hidden" name="status" value={assessment.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"}/><button className="secondary">{assessment.status === "ACTIVE" ? "Inactivate" : "Activate"}</button></form></td></tr>)}{!course.assessments.length && <tr><td colSpan={8}>No assessment uploaded.</td></tr>}</tbody></table></div><p><a className="button secondary" href={withBase(`/api/courses/${course.id}/assessment-results`)}>Download assessment results Excel</a></p></div>
        <div className="card"><h2>Feedback</h2><p><a className="button secondary" href={withBase("/api/templates/feedback")}>Download feedback template</a></p>{publishedModules.length ? <ActionForm action={uploadFeedbackTemplate} submitLabel="Upload and activate feedback"><input type="hidden" name="courseId" value={course.id}/><label>Module<select name="courseContentId" required>{publishedModules.map((content) => <option key={content.id} value={content.id}>{content.lessons[0]?.title ?? content.originalName}</option>)}</select></label><label>Feedback title<input name="title" defaultValue="Course Feedback" required/></label><label>Feedback template<input type="file" name="file" accept=".csv,.xlsx,.xls" required/></label></ActionForm> : <p className="muted">Publish a module with at least one lesson before uploading feedback for it.</p>}<div className="table-wrap"><table><thead><tr><th>Version</th><th>Module</th><th>Status</th><th>Responses</th><th>Action</th></tr></thead><tbody>{activeFeedbackForms.map((form) => <tr key={form.id}><td>v{form.version}</td><td>{form.courseContent?.lessons[0]?.title ?? "Whole course"}</td><td><span className="badge">ACTIVE</span></td><td>{form.responses.length}</td><td><form action={setFeedbackFormActive}><input type="hidden" name="formId" value={form.id}/><input type="hidden" name="isActive" value="false"/><button className="secondary">Archive</button></form></td></tr>)}{!activeFeedbackForms.length && <tr><td colSpan={5}>No active feedback form.</td></tr>}</tbody></table></div>{archivedFeedbackForms.length > 0 && <details className="archived-forms"><summary>Archived feedback forms ({archivedFeedbackForms.length})</summary><div className="table-wrap"><table><thead><tr><th>Version</th><th>Module</th><th>Responses</th><th>Action</th></tr></thead><tbody>{archivedFeedbackForms.map((form) => <tr key={form.id}><td>v{form.version}</td><td>{form.courseContent?.lessons[0]?.title ?? "Whole course"}</td><td>{form.responses.length}</td><td><form action={setFeedbackFormActive}><input type="hidden" name="formId" value={form.id}/><input type="hidden" name="isActive" value="true"/><button className="secondary">Restore</button></form></td></tr>)}</tbody></table></div><p className="muted">Restoring archives whichever form is active for the same module. Responses are never deleted.</p></details>}<p><a className="button secondary" href={withBase(`/api/courses/${course.id}/feedback-export`)}>Download feedback Excel</a></p></div>
      </aside>
    </div>
  </main>;
}
