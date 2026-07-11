import { notFound } from "next/navigation";
import { setAssessmentStatus, uploadAssessment } from "@/actions/assessments";
import { approveContent, editLesson, rejectContent, setCourseStatus } from "@/actions/courses";
import { uploadFeedbackTemplate } from "@/actions/feedback";
import { ActionForm } from "@/components/action-form";
import { parseQuizQuestions } from "@/lib/ai-study-pack";
import { requireCourseManager } from "@/lib/course-access";
import { db } from "@/lib/db";
import { buildLeaderboardRows, formatDuration } from "@/lib/leaderboard";

export default async function TeacherCourse({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCourseManager(id);
  const course = await db.course.findUnique({
    where: { id },
    include: {
      contents: { include: { lessons: true }, orderBy: { version: "asc" } },
      enrollments: { include: { employee: { include: { company: true } }, progress: true }, orderBy: { employee: { name: "asc" } } },
      assessments: { include: { questions: true, attempts: { where: { status: "SUBMITTED" }, include: { employee: { include: { company: true } } } } }, orderBy: { version: "desc" } },
      feedbackForms: { include: { questions: true, responses: true }, orderBy: { version: "desc" } },
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
  const activeAssessment = course.assessments.find((assessment) => assessment.status === "ACTIVE");
  const latestFeedbackForm = course.feedbackForms[0];
  const bestAssessmentAttempts = new Map<string, (typeof course.assessments)[number]["attempts"][number]>();
  for (const attempt of activeAssessment?.attempts ?? []) {
    const existing = bestAssessmentAttempts.get(attempt.employeeId);
    if (!existing || attempt.scorePercent > existing.scorePercent || (attempt.scorePercent === existing.scorePercent && attempt.timeTakenSeconds < existing.timeTakenSeconds)) {
      bestAssessmentAttempts.set(attempt.employeeId, attempt);
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
  const assessmentLeaderboard = buildLeaderboardRows([...bestAssessmentAttempts.values()].map((attempt) => ({
    enrollmentId: attempt.id,
    courseId: course.id,
    courseTitle: course.title,
    employeeCode: attempt.employee.employeeCode,
    employeeName: attempt.employee.name,
    companyName: attempt.employee.company.name,
    enrolledAt: attempt.startedAt,
    startedAt: attempt.startedAt,
    completedAt: attempt.submittedAt,
    totalLessons: 100,
    completedLessons: 0,
    assessmentScorePercent: attempt.scorePercent,
    completionSecondsOverride: attempt.timeTakenSeconds,
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
      <aside className="form"><div className="card"><h2>Learners</h2>{course.hasPendingChanges && course.status === "PUBLISHED" && <p className="message">Learners continue seeing the current version until approved changes are published.</p>}{!course.isActive && <p className="message">This course is inactive for new enrolments, but enrolled learners can still see it.</p>}<div className="table-wrap"><table><thead><tr><th>Name</th><th>Progress</th></tr></thead><tbody>
        {course.enrollments.map((enrollment) => <tr key={enrollment.id}><td>{enrollment.employee.name}<br/><small>{enrollment.employee.employeeCode}</small></td><td><span className="badge">{enrollment.status.replaceAll("_", " ")}</span></td></tr>)}
        {!course.enrollments.length && <tr><td colSpan={2}>No learners enrolled.</td></tr>}
      </tbody></table></div>{course.leaderboardEnabled && <section className="topper-panel"><h2>Toppers</h2><p className="muted">{activeAssessment ? "Formula: assessment score 70% + speed 30%." : "Formula: progress score 70% + speed score 30%."}</p><ol className="leaderboard-list">{(activeAssessment ? assessmentLeaderboard : progressLeaderboard).map((row) => <li key={row.enrollmentId}><strong>{row.employeeName}</strong><span>{row.rankScore}% - {formatDuration(row.completionSeconds)}</span></li>)}</ol>{!(activeAssessment ? assessmentLeaderboard : progressLeaderboard).length && <p>No learner progress yet.</p>}</section>}</div>
        <div className="card"><h2>Learner AI history</h2><p className="muted">Latest learner questions asked in this course.</p><div className="table-wrap"><table><thead><tr><th>Learner</th><th>Question</th><th>Answer / Status</th></tr></thead><tbody>{course.aiInteractions.map((item) => <tr key={item.id}><td>{item.employee.name}<br/><small>{item.employee.employeeCode} - {item.employee.company.name}</small></td><td>{item.question}</td><td>{item.answer ?? item.error ?? item.status}<br/><small>{item.createdAt.toLocaleString("en-IN")}</small></td></tr>)}{!course.aiInteractions.length && <tr><td colSpan={3}>No learner AI history is available yet.</td></tr>}</tbody></table></div></div>
        <div className="card"><h2>Assessment</h2><p><a className="button secondary" href="/api/templates/assessment">Download MCQ template</a></p><ActionForm action={uploadAssessment} submitLabel="Upload and activate assessment"><input type="hidden" name="courseId" value={course.id}/><label>Assessment title<input name="title" defaultValue={activeAssessment?.title ?? "Course Assessment"} required/></label><label>Pass percentage<input name="passPercentage" type="number" min="1" max="100" defaultValue={activeAssessment?.passPercentage ?? course.passPercentage}/></label><label>Overall time limit (minutes)<input name="timeLimitMinutes" type="number" min="1" max="480" defaultValue={activeAssessment ? Math.ceil(activeAssessment.timeLimitSeconds / 60) : 30}/></label><label>Question bank<input type="file" name="file" accept=".csv,.xlsx,.xls" required/></label><label className="checkbox"><input type="checkbox" name="shuffleQuestions" defaultChecked={activeAssessment?.shuffleQuestions ?? false}/>Shuffle questions</label><label className="checkbox"><input type="checkbox" name="showLeaderboard" defaultChecked={activeAssessment?.showLeaderboard ?? true}/>Show leaderboard</label></ActionForm><div className="table-wrap"><table><thead><tr><th>Version</th><th>Status</th><th>Questions</th><th>Time</th><th>Shuffle</th><th>Action</th></tr></thead><tbody>{course.assessments.map((assessment) => <tr key={assessment.id}><td>v{assessment.version}</td><td><span className="badge">{assessment.status}</span></td><td>{assessment.questions.length}</td><td>{Math.ceil(assessment.timeLimitSeconds / 60)} min</td><td>{assessment.shuffleQuestions ? "YES" : "NO"}</td><td><form action={setAssessmentStatus}><input type="hidden" name="assessmentId" value={assessment.id}/><input type="hidden" name="status" value={assessment.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"}/><button className="secondary">{assessment.status === "ACTIVE" ? "Inactivate" : "Activate"}</button></form></td></tr>)}{!course.assessments.length && <tr><td colSpan={6}>No assessment uploaded.</td></tr>}</tbody></table></div><p><a className="button secondary" href={`/api/courses/${course.id}/assessment-results`}>Download assessment results Excel</a></p></div>
        <div className="card"><h2>Feedback</h2><p><a className="button secondary" href="/api/templates/feedback">Download feedback template</a></p><ActionForm action={uploadFeedbackTemplate} submitLabel="Upload and activate feedback"><input type="hidden" name="courseId" value={course.id}/><label>Feedback title<input name="title" defaultValue={latestFeedbackForm?.title ?? "Course Feedback"} required/></label><label>Feedback template<input type="file" name="file" accept=".csv,.xlsx,.xls" required/></label></ActionForm><p className="muted">Active form: {latestFeedbackForm ? `v${latestFeedbackForm.version} (${latestFeedbackForm.responses.length} responses)` : "None"}</p><p><a className="button secondary" href={`/api/courses/${course.id}/feedback-export`}>Download feedback Excel</a></p></div>
      </aside>
    </div>
  </main>;
}
