import { notFound } from "next/navigation";
import { approveContent, editLesson, rejectContent, setCourseStatus } from "@/actions/courses";
import { parseQuizQuestions } from "@/lib/ai-study-pack";
import { requireCourseManager } from "@/lib/course-access";
import { db } from "@/lib/db";

export default async function TeacherCourse({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCourseManager(id);
  const course = await db.course.findUnique({
    where: { id },
    include: {
      contents: { include: { lessons: true }, orderBy: { version: "asc" } },
      enrollments: { include: { employee: true }, orderBy: { employee: { name: "asc" } } },
    },
  });
  if (!course) notFound();
  const activeContents = course.contents.filter((content) => !content.rejectedAt);
  const canPublish = course.hasPendingChanges && activeContents.length > 0 && activeContents.every(
    (content) => content.processingStatus === "COMPLETED" && content.approvedAt && content.lessons.every((lesson) => lesson.approvedAt),
  );

  return <main className="container">
    <span className="badge">{course.status.replaceAll("_", " ")}</span>
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
      <aside className="card"><h2>Learners</h2>{course.hasPendingChanges && course.status === "PUBLISHED" && <p className="message">Learners continue seeing the current version until approved changes are published.</p>}<div className="table-wrap"><table><thead><tr><th>Name</th><th>Progress</th></tr></thead><tbody>
        {course.enrollments.map((enrollment) => <tr key={enrollment.id}><td>{enrollment.employee.name}<br/><small>{enrollment.employee.employeeCode}</small></td><td><span className="badge">{enrollment.status.replaceAll("_", " ")}</span></td></tr>)}
        {!course.enrollments.length && <tr><td colSpan={2}>No learners enrolled.</td></tr>}
      </tbody></table></div></aside>
    </div>
  </main>;
}
