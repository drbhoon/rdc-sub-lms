import { AssessmentKind, AssessmentStatus } from "@prisma/client";
import { buildFinalAssessment } from "@/actions/grading";
import { ActionForm } from "@/components/action-form";
import { GradingSchemeForm } from "@/components/grading-scheme-form";
import { withBase } from "@/lib/base-path";
import { buildFinalBank, checkGradingScheme, finalIsStale } from "@/lib/course-grading";
import { courseModules, loadCourseGrades, schemeFromRow } from "@/lib/course-grades";
import { db } from "@/lib/db";
import { formatIst } from "@/lib/ist";

const scoreText = (score: number | null) => (score === null ? "-" : `${Math.round(score * 10) / 10}`);

/**
 * The admin's side of the course assessment engine: the weights, the final
 * assessment, and every learner's weighted result.
 */
export async function CourseGradingPanel({ courseId }: { courseId: string }) {
  const [modules, grading, moduleQuizzes, finals, enrollments] = await Promise.all([
    courseModules(courseId),
    db.courseGrading.findUnique({ where: { courseId } }),
    db.assessment.findMany({
      where: { courseId, status: AssessmentStatus.ACTIVE, kind: AssessmentKind.MODULE, courseContentId: { not: null } },
      select: { id: true, courseContentId: true, questions: { select: { questionText: true, optionA: true, optionB: true, optionC: true, optionD: true, correctOption: true, timeSeconds: true, order: true } } },
    }),
    db.assessment.findMany({
      where: { courseId, kind: AssessmentKind.FINAL },
      include: { _count: { select: { questions: true, attempts: { where: { status: "SUBMITTED" } } } } },
      orderBy: { version: "desc" },
    }),
    db.enrollment.findMany({
      where: { courseId },
      include: { employee: { select: { id: true, name: true, employeeCode: true } }, classroom: { select: { name: true } } },
      orderBy: { employee: { name: "asc" } },
    }),
  ]);

  const scheme = schemeFromRow(grading);
  const withQuiz = new Set(moduleQuizzes.map((quiz) => quiz.courseContentId));
  const schemeModules = modules.map((module) => ({ ...module, hasAssessment: withQuiz.has(module.id) }));
  const activeFinal = finals.find((final) => final.status === AssessmentStatus.ACTIVE) ?? null;
  const check = scheme ? checkGradingScheme(scheme, schemeModules, Boolean(activeFinal)) : null;
  // What a build would give right now: distinct questions across the module banks.
  const availableBank = buildFinalBank(moduleQuizzes.map((quiz) => ({ assessmentId: quiz.id, questions: quiz.questions }))).questions.length;
  const stale = activeFinal ? finalIsStale(activeFinal.builtFromAssessmentIds, moduleQuizzes.map((quiz) => quiz.id)) : false;
  const grades = scheme ? await loadCourseGrades(courseId, enrollments.map((enrollment) => enrollment.employeeId)) : null;
  const columns = grades?.byEmployee.values().next().value?.grade.components ?? [];

  return <>
    <div className="card" id="course-assessment">
      <h2>Course assessment scheme</h2>
      <p className="muted">
        How this course&apos;s result out of 100 is made up. Give each module&apos;s quiz a weight, tick the
        teacher assessment if teachers should score their learners too, and weight the final assessment.
        The weights must total exactly 100.
      </p>
      {check && check.warnings.length > 0 && <ul className="requirement-list">{check.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      <GradingSchemeForm courseId={courseId} modules={schemeModules} initial={scheme} />
    </div>

    <div className="card" id="final-assessment">
      <h2>Final assessment</h2>
      <p className="muted">
        Draws its questions at random from every module&apos;s active quiz. The module quizzes hold{" "}
        <strong>{availableBank}</strong> distinct question(s) between them right now.
      </p>
      {activeFinal ? <>
        <p>
          <span className="badge">Live: v{activeFinal.version}</span>{" "}
          {activeFinal.questionsPerAttempt ?? activeFinal._count.questions} questions per learner from a bank of {activeFinal._count.questions} ·
          pass mark {activeFinal.passPercentage}% · {Math.round(activeFinal.timeLimitSeconds / 60)} minutes ·
          built {formatIst(activeFinal.createdAt)} · {activeFinal._count.attempts} submitted attempt(s)
        </p>
        {stale && <p className="message">A module quiz has been replaced, added or removed since this final was built, so its bank no longer matches the modules. Build it again to bring it up to date.</p>}
      </> : <p className="muted">Not built yet.</p>}
      <details open={!activeFinal}>
        <summary>{activeFinal ? "Build again (a new version; learners then sit the new one)" : "Build the final assessment"}</summary>
        {availableBank === 0
          ? <p className="muted">Upload the module quizzes first. The final is built from them.</p>
          : <ActionForm action={buildFinalAssessment} submitLabel={activeFinal ? "Build new version" : "Build final assessment"}>
            <input type="hidden" name="courseId" value={courseId} />
            <label>Title<input name="title" defaultValue={activeFinal?.title ?? "Final Assessment"} maxLength={150} required /></label>
            <div className="form-row">
              <label>Questions offered to each learner (random)
                <input name="questionsPerAttempt" type="number" min={1} max={Math.min(200, availableBank)} step={1}
                  defaultValue={Math.min(activeFinal?.questionsPerAttempt ?? 20, availableBank)} required />
              </label>
              <label>Pass mark (%)<input name="passPercentage" type="number" min={1} max={100} defaultValue={activeFinal?.passPercentage ?? 70} required /></label>
              <label>Time limit (minutes)<input name="timeLimitMinutes" type="number" min={1} max={480} defaultValue={activeFinal ? Math.round(activeFinal.timeLimitSeconds / 60) : 30} required /></label>
            </div>
            <label className="checkbox"><input type="checkbox" name="showLeaderboard" defaultChecked={activeFinal?.showLeaderboard ?? true} />Include in the leaderboard</label>
          </ActionForm>}
      </details>
    </div>

    <div className="card" id="course-results">
      <h2>Course results</h2>
      {!grades ? <p className="muted">Save the assessment weights above to see each learner&apos;s course result.</p> : <>
        <p><a className="button secondary" href={withBase(`/api/courses/${courseId}/grades`)}>Download results Excel</a></p>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Learner</th><th>Classroom</th>
              {columns.map((component) => <th key={component.key}>{component.label}<br /><span className="muted">weight {component.weight}</span></th>)}
              <th>Course result /100</th>
            </tr></thead>
            <tbody>
              {enrollments.map((enrollment) => {
                const row = grades.byEmployee.get(enrollment.employeeId);
                if (!row) return null;
                return <tr key={enrollment.id}>
                  <td><strong>{enrollment.employee.name}</strong><br /><span className="muted">{enrollment.employee.employeeCode}</span></td>
                  <td>{enrollment.classroom?.name ?? <span className="muted">-</span>}</td>
                  {row.grade.components.map((component) => <td key={component.key}>{scoreText(component.score)}</td>)}
                  <td><strong>{row.grade.total}</strong>{!row.grade.complete && <><br /><span className="muted">{row.grade.pending.length} pending</span></>}</td>
                </tr>;
              })}
              {!enrollments.length && <tr><td colSpan={columns.length + 3}>No learners are enrolled yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  </>;
}
