import { withBase } from "@/lib/base-path";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { setAssessmentStatus, uploadAssessment } from "@/actions/assessments";
import { deleteCourse, enrollFromTemplate, setCourseActive, updateCourse, updateCourseTeachers } from "@/actions/courses";
import { deleteCourseContent, retryContent } from "@/actions/content";
import { uploadFeedbackTemplate } from "@/actions/feedback";
import { ActionForm } from "@/components/action-form";
import { ContentUploadForm } from "@/components/content-upload-form";
import { CourseEnrollmentPicker } from "@/components/course-enrollment-picker";
import { buildLeaderboardRows, formatDuration } from "@/lib/leaderboard";
import { db } from "@/lib/db";
import { eligibleLearnerForCourseWhere } from "@/lib/enrollment-eligibility";
import { requireRole } from "@/lib/session";
import { eligibleTeacherWhere } from "@/lib/teacher-eligibility";

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
      aiInteractions: { include: { employee: { include: { company: true } } }, orderBy: { createdAt: "desc" }, take: 25 },
      // courseContent + its lesson, so the versions table and the leaderboard
      // can both say WHICH MODULE a quiz belongs to now that a course can
      // have several active at once.
      assessments: {
        include: { questions: true, courseContent: { include: { lessons: true } }, attempts: { where: { status: "SUBMITTED" }, include: { employee: { include: { company: true } } }, orderBy: [{ scorePercent: "desc" }, { timeTakenSeconds: "asc" }] } },
        orderBy: { version: "desc" },
      },
      // courseContent + its lesson, so the versions table can say WHICH
      // MODULE a form belongs to now that a course can have several active
      // at once.
      feedbackForms: {
        include: { questions: true, courseContent: { include: { lessons: true } }, responses: { include: { employee: true, answers: true }, orderBy: { submittedAt: "desc" } } },
        orderBy: { version: "desc" },
      },
    },
  });
  if (!course) notFound();

  const [employees, companies, teachers] = await Promise.all([
    course.isActive && course.status === "PUBLISHED"
      ? db.employee.findMany({
        where: {
          ...eligibleLearnerForCourseWhere(),
          enrollments: { none: { courseId: id } },
        },
        include: { company: true, user: { include: { roles: true } } },
        orderBy: { name: "asc" },
        // Every active employee is eligible now, and there are ~1536 of them.
        // The old 1000 cap silently truncated the list, and since the picker
        // searches what it was given, anyone past the cut simply could not be
        // found — the same "search finds nothing" symptom in a new disguise.
        take: 10000,
      })
      : Promise.resolve([]),
    db.company.findMany({ orderBy: { name: "asc" } }),
    db.user.findMany({
      where: eligibleTeacherWhere(),
      include: { employee: true },
      orderBy: [{ employee: { name: "asc" } }, { email: "asc" }],
    }),
  ]);

  const selectedCompanyIds = new Set(course.companies.map((company) => company.companyId));
  const selectedTeacherIds = new Set(course.teachers.map((teacher) => teacher.userId));
  const totalLessons = course.contents
    .filter((content) => content.isPublished)
    .flatMap((content) => content.lessons.filter((lesson) => lesson.approvedAt))
    .length;
  const publishedModules = course.contents.filter((content) => content.isPublished && content.lessons.length);

  // A quiz belongs to a module now, so a course can have several ACTIVE at
  // once. The combined leaderboard averages each employee's best score
  // across whichever of those they have attempted (excluding any a teacher
  // marked out of the leaderboard), and sums their time on those attempts —
  // more quizzes attempted costs more time, same as it always did for one.
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
              <ActionForm action={deleteCourseContent} submitLabel={content.isPublished ? "Delete published content" : "Delete content"} buttonClassName="danger">
                <input type="hidden" name="contentId" value={content.id} />
                <label className="checkbox"><input type="checkbox" name="confirmDelete" />Confirm permanent deletion</label>
                {content.isPublished && <span className="muted">This immediately removes the lessons and their learner progress.</span>}
              </ActionForm>
            </div>
          </div>)}
          {!course.contents.length && <p>No content uploaded.</p>}
          <hr />
          <h3>Upload content</h3>
          <ContentUploadForm courseId={course.id} />
        </div>

        <div className="card">
          <h2>Assessment</h2>
          <p className="muted">Upload MCQ questions for one module using the RDC realtime quiz format. The latest upload for that module becomes its active quiz — other modules&apos; quizzes are untouched.</p>
          <p><a className="button secondary" href={withBase("/api/templates/assessment")}>Download MCQ template</a></p>
          {publishedModules.length ? <ActionForm action={uploadAssessment} submitLabel="Upload and activate assessment">
            <input type="hidden" name="courseId" value={course.id} />
            <label>Module<select name="courseContentId" required>
              {publishedModules.map((content) => <option key={content.id} value={content.id}>{content.lessons[0]?.title ?? content.originalName}</option>)}
            </select></label>
            <label>Assessment title<input name="title" defaultValue="Course Assessment" required /></label>
            <label>Pass percentage<input name="passPercentage" type="number" min="1" max="100" defaultValue={course.passPercentage} /></label>
            <label>Overall time limit (minutes)<input name="timeLimitMinutes" type="number" min="1" max="480" defaultValue={30} /></label>
            <label>Questions offered per attempt<input name="questionsPerAttempt" type="number" min="1" max="200" defaultValue={20} required /></label>
            <label>Question bank CSV or Excel<input type="file" name="file" accept=".csv,.xlsx,.xls" required /></label>
            <label className="checkbox"><input type="checkbox" name="shuffleQuestions" />Shuffle questions for learners</label>
            <label className="checkbox"><input type="checkbox" name="showLeaderboard" defaultChecked />Show leaderboard to learners</label>
          </ActionForm> : <p className="muted">Publish a module with at least one lesson before uploading a quiz for it.</p>}
          <hr />
          <h3>Assessment versions</h3>
          <div className="table-wrap"><table><thead><tr><th>Version</th><th>Module</th><th>Status</th><th>Question bank</th><th>Offered</th><th>Time</th><th>Shuffle</th><th>Attempts</th><th>Action</th></tr></thead><tbody>
            {course.assessments.map((assessment) => <tr key={assessment.id}>
              <td>v{assessment.version}<br /><span className="muted">{assessment.title}</span></td>
              <td>{assessment.courseContent?.lessons[0]?.title ?? "Whole course"}</td>
              <td><span className="badge">{assessment.status}</span></td>
              <td>{assessment.questions.length}</td>
              <td>{assessment.questionsPerAttempt ?? assessment.questions.length}</td>
              <td>{Math.ceil(assessment.timeLimitSeconds / 60)} min</td>
              <td>{assessment.shuffleQuestions ? "YES" : "NO"}</td>
              <td>{assessment.attempts.length}</td>
              <td><form action={setAssessmentStatus}><input type="hidden" name="assessmentId" value={assessment.id} /><input type="hidden" name="status" value={assessment.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"} /><button className="secondary">{assessment.status === "ACTIVE" ? "Inactivate" : "Activate"}</button></form></td>
            </tr>)}
            {!course.assessments.length && <tr><td colSpan={9}>No assessment uploaded.</td></tr>}
          </tbody></table></div>
          <p><a className="button secondary" href={withBase(`/api/courses/${course.id}/assessment-results`)}>Download assessment results Excel</a></p>
        </div>

        <div className="card">
          <h2>Feedback</h2>
          <p className="muted">Upload a Google Forms-style feedback template for one module. Learners see it once they complete that module — other modules&apos; feedback is untouched.</p>
          <p><a className="button secondary" href={withBase("/api/templates/feedback")}>Download feedback template</a></p>
          {publishedModules.length ? <ActionForm action={uploadFeedbackTemplate} submitLabel="Upload and activate feedback">
            <input type="hidden" name="courseId" value={course.id} />
            <label>Module<select name="courseContentId" required>
              {publishedModules.map((content) => <option key={content.id} value={content.id}>{content.lessons[0]?.title ?? content.originalName}</option>)}
            </select></label>
            <label>Feedback title<input name="title" defaultValue="Course Feedback" required /></label>
            <label>Feedback CSV or Excel<input type="file" name="file" accept=".csv,.xlsx,.xls" required /></label>
          </ActionForm> : <p className="muted">Publish a module with at least one lesson before uploading feedback for it.</p>}
          <hr />
          <h3>Feedback forms</h3>
          <div className="table-wrap"><table><thead><tr><th>Version</th><th>Module</th><th>Status</th><th>Questions</th><th>Responses</th></tr></thead><tbody>
            {course.feedbackForms.map((form) => <tr key={form.id}><td>v{form.version}<br /><span className="muted">{form.title}</span></td><td>{form.courseContent?.lessons[0]?.title ?? "Whole course"}</td><td><span className="badge">{form.isActive ? "ACTIVE" : "INACTIVE"}</span></td><td>{form.questions.length}</td><td>{form.responses.length}</td></tr>)}
            {!course.feedbackForms.length && <tr><td colSpan={5}>No feedback template uploaded.</td></tr>}
          </tbody></table></div>
          <p><a className="button secondary" href={withBase(`/api/courses/${course.id}/feedback-export`)}>Download feedback Excel</a></p>
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
          <ActionForm action={deleteCourse} submitLabel="Permanently delete course" buttonClassName="danger">
            <input type="hidden" name="courseId" value={course.id} />
            <p className="error">This deletes all content, enrollments, progress, assessments, feedback, certificates and AI history.</p>
            <label>Type the course title to confirm<input name="confirmTitle" autoComplete="off" placeholder={course.title} /></label>
          </ActionForm>
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
          {course.status !== "PUBLISHED" ? <p>Publish this course before enrolling learners.</p> : !course.isActive ? <p>Reactivate this course before enrolling new learners.</p> : <>
            {employees.length ? <CourseEnrollmentPicker
              courseId={course.id}
              employees={employees.map((employee) => ({
                id: employee.id,
                name: employee.name,
                employeeCode: employee.employeeCode,
                email: employee.email,
                companyName: employee.company.name,
                isAdminLearner: employee.user?.roles.some((role) => role.role === UserRole.SUPER_ADMIN) ?? false,
              }))}
            /> : <p>All existing employees are enrolled.</p>}

            <hr />
            <h3>Or upload a roster</h3>
            <p className="muted">
              For a full class list at once. Matches existing employees by e-mail;
              an e-mail nobody has seen — an intern, for example — is registered
              as a new learner and enrolled in the same step.{" "}
              <a href={withBase("/api/templates/enrollment")}>Download the template</a>.
            </p>
            <ActionForm action={enrollFromTemplate} submitLabel="Upload and enroll">
              <input type="hidden" name="courseId" value={course.id} />
              <label>Roster CSV or Excel<input type="file" name="file" accept=".csv,.xlsx,.xls" required /></label>
            </ActionForm>
          </>}
        </div>

        <div className="card">
          <h2>Learner AI history</h2>
          <p className="muted">Latest questions asked by learners in this course.</p>
          <p><a className="button secondary" href={withBase(`/api/courses/${course.id}/ai-history`)}>Download complete AI history Excel</a></p>
          <div className="table-wrap"><table><thead><tr><th>Learner</th><th>Mode</th><th>Question</th><th>Answer / Status</th><th>Asked</th></tr></thead><tbody>
            {course.aiInteractions.map((item) => <tr key={item.id}>
              <td>{item.employee.name}<br /><span className="muted">{item.employee.employeeCode} - {item.employee.company.name}</span></td>
              <td>{item.channel}{item.language ? ` · ${item.language.toUpperCase()}` : ""}</td>
              <td>{item.question}</td>
              <td>{item.answer ?? item.error ?? item.status}</td>
              <td>{item.createdAt.toLocaleString("en-IN")}</td>
            </tr>)}
            {!course.aiInteractions.length && <tr><td colSpan={5}>No learner AI history is available yet.</td></tr>}
          </tbody></table></div>
        </div>

        {course.leaderboardEnabled && <div className="card">
          <h2>Toppers</h2>
          <p className="muted">{assessmentLeaderboard.length ? "Formula: assessment score 70% + assessment speed 30%. Assessment score is averaged across every quiz-eligible module attempted." : "Formula: progress score 70% + speed score 30%."}</p>
          <ol className="leaderboard-list">
            {(assessmentLeaderboard.length ? assessmentLeaderboard : progressLeaderboard).map((row) => <li key={row.enrollmentId}>
              <strong>{row.employeeName}</strong>
              <span>{row.rankScore}% - {formatDuration(row.completionSeconds)}</span>
            </li>)}
          </ol>
          {!(assessmentLeaderboard.length ? assessmentLeaderboard : progressLeaderboard).length && <p>No learner progress yet.</p>}
        </div>}
      </aside>
    </div>
  </main>;
}
