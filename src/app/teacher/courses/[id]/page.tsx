import { withBase } from "@/lib/base-path";
import { notFound } from "next/navigation";
import { approveContent, editLesson, rejectContent, setCourseStatus } from "@/actions/courses";
import { ActionForm } from "@/components/action-form";
import { ModuleActivities } from "@/components/module-activities";
import { LearnerAiHistory } from "@/components/learner-ai-history";
import { ModulePicker } from "@/components/module-picker";
import { loadAiHistoryLearners } from "@/lib/ai-history";
import { TeacherEvaluationPanel } from "@/components/teacher-evaluation-panel";
import { parseQuizQuestions } from "@/lib/ai-study-pack";
import { requireCourseManager } from "@/lib/course-access";
import { db } from "@/lib/db";
import { buildLeaderboardRows, formatDuration } from "@/lib/leaderboard";
import { classroomScope, enrollmentScopeWhere } from "@/lib/classroom-scope";
import { answerLearnerQuestion } from "@/actions/course-questions";
import { formatIst } from "@/lib/ist";

type ContentState = { processingStatus: string; isPublished: boolean; approvedAt: Date | null; rejectedAt: Date | null };

/** Something this teacher still has to act on. */
const needsApproval = (content: ContentState) => content.processingStatus === "COMPLETED" && !content.approvedAt && !content.rejectedAt;

/** "Module 2: Safety - awaiting approval": enough to find the one that needs attention without opening each. */
function moduleOptionLabel(content: ContentState & { originalName: string; lessons: { title: string }[] }, index: number) {
  const state = content.rejectedAt ? "rejected"
    : content.processingStatus !== "COMPLETED" ? content.processingStatus.toLowerCase()
    : !content.approvedAt ? "awaiting approval"
    : content.isPublished ? "live" : "approved";
  return `Module ${index + 1}: ${content.lessons[0]?.title ?? content.originalName} - ${state}`;
}

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
  // Scoped the same way the roster is: a teacher running classrooms sees only
  // their own learners' questions; one running none still sees the course's.
  const learnerQuestions = await db.courseQuestion.findMany({
    where: { courseId: id, employee: { enrollments: { some: { courseId: id, ...enrollmentScopeWhere(scope) } } } },
    include: { employee: { include: { enrollments: { where: { courseId: id }, include: { classroom: { select: { name: true } } } } } } },
    orderBy: [{ answeredAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    take: 50,
  });
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
    },
  });
  if (!course) notFound();
  const aiLearners = await loadAiHistoryLearners(id);
  const activeContents = course.contents.filter((content) => !content.rejectedAt);
  const canPublish = course.hasPendingChanges && activeContents.length > 0 && activeContents.every(
    (content) => content.processingStatus === "COMPLETED" && content.approvedAt && content.lessons.every((lesson) => lesson.approvedAt),
  );
  const totalLessons = course.contents
    .filter((content) => content.isPublished)
    .flatMap((content) => content.lessons.filter((lesson) => lesson.approvedAt))
    .length;

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
          <ModulePicker legend="Module" initialId={(course.contents.find(needsApproval) ?? course.contents[0])?.id} options={course.contents.map((content, index) => { const questions = parseQuizQuestions(content.quizQuestions); return { id: content.id, label: moduleOptionLabel(content, index), panel: <article className="card">
            <h3>Module {index + 1}: {content.originalName}</h3>
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
          </article> }; })} />
        </div>
        {canPublish && <div className="card"><h2>{course.status === "PUBLISHED" ? "Publish approved changes" : "Publish course"}</h2><p>All current content is processed and approved.</p><form action={setCourseStatus}><input type="hidden" name="courseId" value={course.id}/><input type="hidden" name="status" value="PUBLISHED"/><button>{course.status === "PUBLISHED" ? "Publish changes" : "Publish to enrolled learners"}</button></form></div>}
      </section>
      <aside className="form"><div className="card"><h2>Learners</h2>{scope.scoped && <p className="message">Showing only your classroom{ownedClassrooms.length > 1 ? "s" : ""}: {ownedClassrooms.map((room) => room.name).join(", ")}.</p>}{course.hasPendingChanges && course.status === "PUBLISHED" && <p className="message">Learners continue seeing the current version until approved changes are published.</p>}{!course.isActive && <p className="message">This course is inactive for new enrolments, but enrolled learners can still see it.</p>}<div className="table-wrap"><table><thead><tr><th>Name</th><th>Classroom</th><th>Progress</th></tr></thead><tbody>
        {course.enrollments.map((enrollment) => <tr key={enrollment.id}><td>{enrollment.employee.name}<br/><small>{enrollment.employee.employeeCode}</small></td><td>{enrollment.classroom?.name ?? <span className="muted">Unassigned</span>}</td><td><span className="badge">{enrollment.status.replaceAll("_", " ")}</span></td></tr>)}
        {!course.enrollments.length && <tr><td colSpan={2}>No learners enrolled.</td></tr>}
      </tbody></table></div>{course.leaderboardEnabled && <section className="topper-panel"><h2>Toppers</h2><p className="muted">{assessmentLeaderboard.length ? "Formula: assessment score 70% + speed 30%. Assessment score is averaged across every quiz-eligible module attempted." : "Formula: progress score 70% + speed score 30%."}</p><ol className="leaderboard-list">{(assessmentLeaderboard.length ? assessmentLeaderboard : progressLeaderboard).map((row) => <li key={row.enrollmentId}><strong>{row.employeeName}</strong><span>{row.rankScore}% - {formatDuration(row.completionSeconds)}</span></li>)}</ol>{!(assessmentLeaderboard.length ? assessmentLeaderboard : progressLeaderboard).length && <p>No learner progress yet.</p>}</section>}</div>
        <TeacherEvaluationPanel courseId={course.id} learners={course.enrollments.map((enrollment) => ({
          employeeId: enrollment.employeeId,
          name: enrollment.employee.name,
          employeeCode: enrollment.employee.employeeCode,
          classroomName: enrollment.classroom?.name ?? null,
        }))} />
        <div className="card"><h2>Learner questions for you</h2><p className="muted">Questions your learners chose to send to you rather than the AI. Unanswered ones are listed first.</p>
          {learnerQuestions.map((item) => <div className="teacher-thread" key={item.id}>
            <p><b>{item.employee.name}</b> <small className="muted">{item.employee.employeeCode}{item.employee.enrollments[0]?.classroom ? ` · ${item.employee.enrollments[0].classroom.name}` : ""}</small></p>
            <p>{item.question}</p>
            {item.answer
              ? <><p><b>Your answer:</b> {item.answer}</p><small className="muted">Answered {formatIst(item.answeredAt)}</small></>
              : <ActionForm action={answerLearnerQuestion} submitLabel="Send answer">
                  <input type="hidden" name="questionId" value={item.id} />
                  <label>Your answer<textarea name="answer" required /></label>
                </ActionForm>}
          </div>)}
          {!learnerQuestions.length && <p className="muted">No learner has asked you anything yet.</p>}
        </div>
        <div className="card"><h2>Learner AI history</h2><p className="muted">Pick a learner to see what they asked in this course.</p><p><a className="button secondary" href={withBase(`/api/courses/${course.id}/ai-history`)}>Download complete AI history Excel</a></p><LearnerAiHistory courseId={course.id} learners={aiLearners} /></div>
        <ModuleActivities
          courseId={course.id}
          passPercentage={course.passPercentage}
          modules={course.contents}
          assessments={course.assessments.filter((assessment) => assessment.kind !== "FINAL")}
          feedbackForms={course.feedbackForms}
        />
      </aside>
    </div>
  </main>;
}
