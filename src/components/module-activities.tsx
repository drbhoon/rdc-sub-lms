import { setAssessmentStatus, uploadAssessment } from "@/actions/assessments";
import { setFeedbackFormActive, uploadFeedbackTemplate } from "@/actions/feedback";
import { ActionForm } from "@/components/action-form";
import { withBase } from "@/lib/base-path";

type Module = { id: string; version: number; isPublished: boolean; originalName: string; lessons: { title: string }[] };
type Quiz = {
  id: string; version: number; title: string; status: string; courseContentId: string | null;
  questionsPerAttempt: number | null; timeLimitSeconds: number; shuffleQuestions: boolean; passPercentage: number;
  questions: unknown[]; attempts: unknown[];
};
type Form = { id: string; version: number; title: string; isActive: boolean; courseContentId: string | null; questions: unknown[]; responses: unknown[] };

const moduleTitle = (module: Module) => module.lessons[0]?.title ?? module.originalName;

/**
 * Assessments and feedback laid out module by module.
 *
 * Both belong to a module, not to the course, so one card per course listing
 * every quiz and form of every module side by side made it hard to see what a
 * given module actually has. Each module now gets its own block holding its
 * quiz and its feedback — what is live, older versions, and the upload for
 * that module alone.
 *
 * Shared by the admin and teacher course pages so the two cannot drift apart.
 * Quizzes and forms uploaded before they were per-module (no module) get a
 * "Whole course" block of their own, shown only when there are any.
 */
export function ModuleActivities({ courseId, passPercentage, modules, assessments, feedbackForms }: {
  courseId: string;
  passPercentage: number;
  modules: Module[];
  assessments: Quiz[];
  feedbackForms: Form[];
}) {
  const ordered = [...modules].sort((a, b) => a.version - b.version);
  const live = ordered.filter((module) => module.isPublished && module.lessons.length);
  // A quiz or form can outlive its module's publication; its block still shows
  // so nothing that holds learners' results disappears from view.
  const referenced = new Set([...assessments, ...feedbackForms].map((item) => item.courseContentId).filter(Boolean));
  const blocks = ordered.filter((module) => live.includes(module) || referenced.has(module.id));
  const wholeCourseQuizzes = assessments.filter((item) => !item.courseContentId);
  const wholeCourseForms = feedbackForms.filter((item) => !item.courseContentId);

  return <div className="card">
    <h2>Assessments and feedback, by module</h2>
    <p className="muted">Each module has its own MCQ quiz and its own feedback form. Uploading for a module replaces only that module&apos;s live version; older versions and their results are kept.</p>
    <div className="button-row">
      <a className="button secondary" href={withBase("/api/templates/assessment")}>MCQ template</a>
      <a className="button secondary" href={withBase("/api/templates/feedback")}>Feedback template</a>
      <a className="button secondary" href={withBase(`/api/courses/${courseId}/assessment-results`)}>All assessment results</a>
      <a className="button secondary" href={withBase(`/api/courses/${courseId}/feedback-export`)}>All feedback</a>
    </div>
    {!blocks.length && !wholeCourseQuizzes.length && !wholeCourseForms.length && <p className="muted">Publish a module with at least one lesson before adding a quiz or feedback to it.</p>}

    {blocks.map((module) => <section className="module-block" key={module.id}>
      <h3>Module {ordered.indexOf(module) + 1}: {moduleTitle(module)} {!live.includes(module) && <span className="badge badge-muted">Not live</span>}</h3>
      <div className="module-parts">
        <QuizPart courseId={courseId} passPercentage={passPercentage} moduleId={module.id} canUpload={live.includes(module)}
          quizzes={assessments.filter((item) => item.courseContentId === module.id)} />
        <FeedbackPart courseId={courseId} moduleId={module.id} canUpload={live.includes(module)}
          forms={feedbackForms.filter((item) => item.courseContentId === module.id)} />
      </div>
    </section>)}

    {(wholeCourseQuizzes.length > 0 || wholeCourseForms.length > 0) && <section className="module-block">
      <h3>Whole course <span className="muted">(uploaded before quizzes and feedback were per module)</span></h3>
      <div className="module-parts">
        <QuizPart courseId={courseId} passPercentage={passPercentage} moduleId={null} canUpload={false} quizzes={wholeCourseQuizzes} />
        <FeedbackPart courseId={courseId} moduleId={null} canUpload={false} forms={wholeCourseForms} />
      </div>
    </section>}
  </div>;
}

function QuizPart({ courseId, passPercentage, moduleId, canUpload, quizzes }: {
  courseId: string; passPercentage: number; moduleId: string | null; canUpload: boolean; quizzes: Quiz[];
}) {
  const active = quizzes.filter((quiz) => quiz.status === "ACTIVE");
  const others = quizzes.filter((quiz) => quiz.status !== "ACTIVE");
  const attempts = quizzes.reduce((sum, quiz) => sum + quiz.attempts.length, 0);
  return <div className="module-part">
    <h4>MCQ quiz</h4>
    {active.map((quiz) => <div key={quiz.id}>
      <p><span className="badge">Live</span> <strong>{quiz.title}</strong> v{quiz.version}</p>
      <p className="muted">{quiz.questionsPerAttempt ?? quiz.questions.length} of {quiz.questions.length} questions per attempt · {Math.ceil(quiz.timeLimitSeconds / 60)} min · pass {quiz.passPercentage}% · shuffle {quiz.shuffleQuestions ? "on" : "off"} · {quiz.attempts.length} submitted</p>
      <StatusButton assessmentId={quiz.id} active />
    </div>)}
    {!active.length && <p className="muted">No live quiz.</p>}
    {others.length > 0 && <details>
      <summary>Earlier versions ({others.length})</summary>
      <div className="table-wrap"><table><thead><tr><th>Version</th><th>Questions</th><th>Submitted</th><th></th></tr></thead><tbody>
        {others.map((quiz) => <tr key={quiz.id}><td>v{quiz.version}<br /><span className="muted">{quiz.title}</span></td><td>{quiz.questions.length}</td><td>{quiz.attempts.length}</td><td><StatusButton assessmentId={quiz.id} active={false} /></td></tr>)}
      </tbody></table></div>
    </details>}
    {canUpload && moduleId && <details>
      <summary>{active.length ? "Upload a new version" : "Upload a quiz"}</summary>
      <ActionForm action={uploadAssessment} submitLabel="Upload and make live">
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="courseContentId" value={moduleId} />
        <label>Assessment title<input name="title" defaultValue="Module Assessment" required /></label>
        <label>Pass percentage<input name="passPercentage" type="number" min="1" max="100" defaultValue={passPercentage} /></label>
        <label>Overall time limit (minutes)<input name="timeLimitMinutes" type="number" min="1" max="480" defaultValue={30} /></label>
        <label>Questions offered per attempt<input name="questionsPerAttempt" type="number" min="1" max="200" defaultValue={20} required /></label>
        <label>Question bank CSV or Excel<input type="file" name="file" accept=".csv,.xlsx,.xls" required /></label>
        <label className="checkbox"><input type="checkbox" name="shuffleQuestions" />Shuffle questions for learners</label>
        <label className="checkbox"><input type="checkbox" name="showLeaderboard" defaultChecked />Show leaderboard to learners</label>
      </ActionForm>
    </details>}
    {attempts > 0 && moduleId && <p><a href={withBase(`/api/courses/${courseId}/assessment-results?module=${moduleId}`)}>Download this module&apos;s results</a></p>}
  </div>;
}

function StatusButton({ assessmentId, active }: { assessmentId: string; active: boolean }) {
  return <form action={setAssessmentStatus}>
    <input type="hidden" name="assessmentId" value={assessmentId} />
    <input type="hidden" name="status" value={active ? "INACTIVE" : "ACTIVE"} />
    <button className="secondary">{active ? "Take offline" : "Make live"}</button>
  </form>;
}

function FeedbackPart({ courseId, moduleId, canUpload, forms }: { courseId: string; moduleId: string | null; canUpload: boolean; forms: Form[] }) {
  const active = forms.filter((form) => form.isActive);
  const archived = forms.filter((form) => !form.isActive);
  const responses = forms.reduce((sum, form) => sum + form.responses.length, 0);
  return <div className="module-part">
    <h4>Feedback</h4>
    {active.map((form) => <div key={form.id}>
      <p><span className="badge">Live</span> <strong>{form.title}</strong> v{form.version}</p>
      <p className="muted">{form.questions.length} questions · {form.responses.length} responses</p>
      <FormButton formId={form.id} active />
    </div>)}
    {!active.length && <p className="muted">No live feedback form.</p>}
    {archived.length > 0 && <details>
      <summary>Archived ({archived.length})</summary>
      <div className="table-wrap"><table><thead><tr><th>Version</th><th>Questions</th><th>Responses</th><th></th></tr></thead><tbody>
        {archived.map((form) => <tr key={form.id}><td>v{form.version}<br /><span className="muted">{form.title}</span></td><td>{form.questions.length}</td><td>{form.responses.length}</td><td><FormButton formId={form.id} active={false} /></td></tr>)}
      </tbody></table></div>
      <p className="muted">Restoring a form archives the one live for this module. Responses are never deleted.</p>
    </details>}
    {canUpload && moduleId && <details>
      <summary>{active.length ? "Upload a new version" : "Upload a feedback form"}</summary>
      <ActionForm action={uploadFeedbackTemplate} submitLabel="Upload and make live">
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="courseContentId" value={moduleId} />
        <label>Feedback title<input name="title" defaultValue="Module Feedback" required /></label>
        <label>Feedback CSV or Excel<input type="file" name="file" accept=".csv,.xlsx,.xls" required /></label>
      </ActionForm>
    </details>}
    {responses > 0 && moduleId && <p><a href={withBase(`/api/courses/${courseId}/feedback-export?module=${moduleId}`)}>Download this module&apos;s feedback</a></p>}
  </div>;
}

function FormButton({ formId, active }: { formId: string; active: boolean }) {
  return <form action={setFeedbackFormActive}>
    <input type="hidden" name="formId" value={formId} />
    <input type="hidden" name="isActive" value={active ? "false" : "true"} />
    <button className="secondary">{active ? "Archive" : "Restore"}</button>
  </form>;
}
