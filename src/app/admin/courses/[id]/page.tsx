import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { setAssessmentStatus, uploadAssessment } from "@/actions/assessments";
import { deleteCourse, enrollEmployees, setCourseActive, updateCourse, updateCourseTeachers } from "@/actions/courses";
import { deleteUnpublishedContent, retryContent } from "@/actions/content";
import { uploadFeedbackTemplate } from "@/actions/feedback";
import { ActionForm } from "@/components/action-form";
import { ContentUploadForm } from "@/components/content-upload-form";
import { buildLeaderboardRows, formatDuration } from "@/lib/leaderboard";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

export default async function CourseAdminPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(UserRole.SUPER_ADMIN);
  const { id } = await params;
  const course = await db.course.findUnique({
    where: { id },
    include: {
      companies: { include: { company: true } },
      teachers: { include: { user: { include: { employee: true } } } },
      contents: { include: { lessons: true }, orderBy: { version: "desc" } },
      enrollments: { include: { employee: { include: { company: true } }, progress: true }, orderBy: { employee: { name: "asc" } } },
      assessments: {
        include: { questions: true, attempts: { where: { status: "SUBMITTED" }, include: { employee: { include: { company: true } } }, orderBy: [{ scorePercent: "desc" }, { timeTakenSeconds: "asc" }] } },
        orderBy: { version: "desc" },
      },
      feedbackForms: {
        include: { questions: true, responses: { include: { employee: true, answers: true }, orderBy: { submittedAt: "desc" } } },
        orderBy: { version: "desc" },
      },
    },
  });
  if (!course) notFound();

  const [employees, companies, teachers] = await Promise.all([
    course.isActive
      ? db.employee.findMany({
        where: { status: "ACTIVE", companyId: { in: course.companies.map((c) => c.companyId) }, enrollments: { none: { courseId: id } } },
        orderBy: { name: "asc" },
      })
      : Promise.resolve([]),
    db.company.findMany({ orderBy: { name: "asc" } }),
    db.user.findMany({
      where: { roles: { some: { role: UserRole.TEACHER } }, employee: { status: "ACTIVE" } },
      include: { employee: true },
      orderBy: { employee: { name: "asc" } },
    }),
  ]);

  const selectedCompanyIds = new Set(course.companies.map((company) => company.companyId));
  const selectedTeacherIds = new Set(course.teachers.map((teacher) => teacher.userId));
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
    <div className="badge-row">
      <span className="badge">{course.status.replaceAll("_", " ")}</span>
      <span className={`badge ${course.isActive ? "" : "badge-muted"}`}>{course.isActive ? "Active" : "Inactive"}</span>
    </div>
    <h1>{course.title}</h1>
    <p>{course.description}</p>

    <div className="two-col">
      <section className="form">
        <div className="card">
          <h2>Content</h2>
          {course.contents.map((content) => <div className="card" key={content.id}>
            <strong>Version {content.version}: {content.originalName}</strong>
            <p><span className="badge">{content.processingStatus}</span> {content.isPublished && <span className="badge">LIVE</span>} - {(content.sizeBytes / 1048576).toFixed(1)} MB</p>
            {content.processingError && <p className="error">{content.processingError}</p>}
            <p>{content.lessons.length} lesson(s) {content.approvedAt ? "- Approved" : ""}</p>
            <div className="form-row">
              {content.processingStatus === "FAILED" && <form action={retryContent}><input type="hidden" name="contentId" value={content.id} /><button className="secondary">Retry processing</button></form>}
              {!content.isPublished && <form action={deleteUnpublishedContent}><input type="hidden" name="contentId" value={content.id} /><button className="secondary">Delete unpublished upload</button></form>}
            </div>
          </div>)}
          {!course.contents.length && <p>No content uploaded.</p>}
          <hr />
          <h3>Upload content</h3>
          <ContentUploadForm courseId={course.id} />
        </div>

        <div className="card">
          <h2>Assessment</h2>
          <p className="muted">Upload MCQ questions using the RDC realtime quiz format. The latest upload becomes the active assessment.</p>
          <p><a className="button secondary" href="/api/templates/assessment">Download MCQ template</a></p>
          <ActionForm action={uploadAssessment} submitLabel="Upload and activate assessment">
            <input type="hidden" name="courseId" value={course.id} />
            <label>Assessment title<input name="title" defaultValue={activeAssessment?.title ?? "Course Assessment"} required /></label>
            <label>Pass percentage<input name="passPercentage" type="number" min="1" max="100" defaultValue={activeAssessment?.passPercentage ?? course.passPercentage} /></label>
            <label>Question bank CSV or Excel<input type="file" name="file" accept=".csv,.xlsx,.xls" required /></label>
            <label className="checkbox"><input type="checkbox" name="showLeaderboard" defaultChecked={activeAssessment?.showLeaderboard ?? true} />Show leaderboard to learners</label>
          </ActionForm>
          <hr />
          <h3>Assessment versions</h3>
          <div className="table-wrap"><table><thead><tr><th>Version</th><th>Status</th><th>Questions</th><th>Attempts</th><th>Action</th></tr></thead><tbody>
            {course.assessments.map((assessment) => <tr key={assessment.id}>
              <td>v{assessment.version}<br /><span className="muted">{assessment.title}</span></td>
              <td><span className="badge">{assessment.status}</span></td>
              <td>{assessment.questions.length}</td>
              <td>{assessment.attempts.length}</td>
              <td><form action={setAssessmentStatus}><input type="hidden" name="assessmentId" value={assessment.id} /><input type="hidden" name="status" value={assessment.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"} /><button className="secondary">{assessment.status === "ACTIVE" ? "Inactivate" : "Activate"}</button></form></td>
            </tr>)}
            {!course.assessments.length && <tr><td colSpan={5}>No assessment uploaded.</td></tr>}
          </tbody></table></div>
          <p><a className="button secondary" href={`/api/courses/${course.id}/assessment-results`}>Download assessment results Excel</a></p>
        </div>

        <div className="card">
          <h2>Feedback</h2>
          <p className="muted">Upload a Google Forms-style feedback template. Learners see it after course completion.</p>
          <p><a className="button secondary" href="/api/templates/feedback">Download feedback template</a></p>
          <ActionForm action={uploadFeedbackTemplate} submitLabel="Upload and activate feedback">
            <input type="hidden" name="courseId" value={course.id} />
            <label>Feedback title<input name="title" defaultValue={latestFeedbackForm?.title ?? "Course Feedback"} required /></label>
            <label>Feedback CSV or Excel<input type="file" name="file" accept=".csv,.xlsx,.xls" required /></label>
          </ActionForm>
          <hr />
          <h3>Feedback forms</h3>
          <div className="table-wrap"><table><thead><tr><th>Version</th><th>Status</th><th>Questions</th><th>Responses</th></tr></thead><tbody>
            {course.feedbackForms.map((form) => <tr key={form.id}><td>v{form.version}<br /><span className="muted">{form.title}</span></td><td><span className="badge">{form.isActive ? "ACTIVE" : "INACTIVE"}</span></td><td>{form.questions.length}</td><td>{form.responses.length}</td></tr>)}
            {!course.feedbackForms.length && <tr><td colSpan={4}>No feedback template uploaded.</td></tr>}
          </tbody></table></div>
          <p><a className="button secondary" href={`/api/courses/${course.id}/feedback-export`}>Download feedback Excel</a></p>
        </div>

        <div className="card">
          <h2>Edit course</h2>
          <ActionForm action={updateCourse} submitLabel="Save course changes">
            <input type="hidden" name="courseId" value={course.id} />
            <label>Course title<input name="title" required defaultValue={course.title} /></label>
            <label>Category<input name="category" required defaultValue={course.category} /></label>
            <label>Description<textarea name="description" required defaultValue={course.description} /></label>
            <div className="form-row">
              <label>Duration (minutes)<input name="durationMinutes" type="number" min="1" defaultValue={course.durationMinutes} /></label>
              <label>Pass percentage<input name="passPercentage" type="number" min="1" max="100" defaultValue={course.passPercentage} /></label>
            </div>
            <label>AI token allowance<input name="aiTokenLimit" type="number" min="0" defaultValue={course.aiTokenLimit} /></label>
            <fieldset>
              <legend>Applicable companies</legend>
              {companies.map((company) => <label className="checkbox" key={company.id}>
                <input type="checkbox" name="companyIds" value={company.id} defaultChecked={selectedCompanyIds.has(company.id)} />{company.name}
              </label>)}
            </fieldset>
            <label className="checkbox"><input type="checkbox" name="certificateEnabled" defaultChecked={course.certificateEnabled} />Certificate enabled</label>
            <label className="checkbox"><input type="checkbox" name="leaderboardEnabled" defaultChecked={course.leaderboardEnabled} />Leaderboard enabled</label>
          </ActionForm>
        </div>
      </section>

      <aside className="form">
        <div className="card">
          <h2>Course controls</h2>
          <p><strong>Teachers:</strong> {course.teachers.length ? course.teachers.map((t) => t.user.employee?.name ?? t.user.email).join(", ") : "None assigned"}</p>
          <p><strong>Companies:</strong> {course.companies.map((c) => c.company.name).join(", ")}</p>
          <p><strong>Duration:</strong> {course.durationMinutes} minutes</p>
          <p><strong>Enrolled:</strong> {course.enrollments.length}</p>
          {!course.isActive && <p className="message">Inactive courses remain visible to already enrolled learners, but new enrolments are blocked.</p>}
          <form action={setCourseActive}>
            <input type="hidden" name="courseId" value={course.id} />
            <input type="hidden" name="isActive" value={course.isActive ? "false" : "true"} />
            <button className="secondary">{course.isActive ? "Set course inactive" : "Reactivate course"}</button>
          </form>
          <form action={deleteCourse}>
            <input type="hidden" name="courseId" value={course.id} />
            <button className="secondary">Delete course if no learner history</button>
          </form>
        </div>

        <div className="card">
          <h2>Assign teachers</h2>
          <ActionForm action={updateCourseTeachers} submitLabel="Save teacher assignment">
            <input type="hidden" name="courseId" value={course.id} />
            {teachers.length ? teachers.map((teacher) => <label className="checkbox" key={teacher.id}>
              <input type="checkbox" name="teacherIds" value={teacher.id} defaultChecked={selectedTeacherIds.has(teacher.id)} />{teacher.employee?.name ?? teacher.email}
            </label>) : <p className="muted">No active teachers are available. Grant teacher role from Employees first.</p>}
          </ActionForm>
        </div>

        <div className="card">
          <h2>Enroll employees</h2>
          {!course.isActive ? <p>Reactivate this course before enrolling new learners.</p> : employees.length ? <form action={enrollEmployees} className="form">
            <input type="hidden" name="courseId" value={course.id} />
            <div style={{ maxHeight: 280, overflow: "auto" }}>
              {employees.map((employee) => <label className="checkbox" key={employee.id}>
                <input type="checkbox" name="employeeIds" value={employee.id} />{employee.name} ({employee.employeeCode})
              </label>)}
            </div>
            <button>Enroll selected</button>
          </form> : <p>All eligible employees are enrolled.</p>}
        </div>

        {course.leaderboardEnabled && <div className="card">
          <h2>Toppers</h2>
          <p className="muted">{activeAssessment ? "Formula: assessment score 70% + assessment speed 30%." : "Formula: progress score 70% + speed score 30%."}</p>
          <ol className="leaderboard-list">
            {(activeAssessment ? assessmentLeaderboard : progressLeaderboard).map((row) => <li key={row.enrollmentId}>
              <strong>{row.employeeName}</strong>
              <span>{row.rankScore}% - {formatDuration(row.completionSeconds)}</span>
            </li>)}
          </ol>
          {!(activeAssessment ? assessmentLeaderboard : progressLeaderboard).length && <p>No learner progress yet.</p>}
        </div>}
      </aside>
    </div>
  </main>;
}
