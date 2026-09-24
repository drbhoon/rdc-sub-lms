import { saveTeacherEvaluation } from "@/actions/grading";
import { ActionForm } from "@/components/action-form";
import { loadCourseGrades } from "@/lib/course-grades";
import { formatIst } from "@/lib/ist";

type Learner = { employeeId: string; name: string; employeeCode: string; classroomName: string | null };

/**
 * The teacher's own assessment of each learner: one score out of 100 and
 * comments. Shown only when an admin has switched the teacher assessment on
 * for this course. The learners listed are the ones this teacher may see — the
 * page has already applied the classroom rules.
 */
export async function TeacherEvaluationPanel({ courseId, learners }: { courseId: string; learners: Learner[] }) {
  const grades = await loadCourseGrades(courseId, learners.map((learner) => learner.employeeId));
  if (!grades?.scheme.teacherAssessmentEnabled) return null;

  return <div className="card" id="teacher-assessment">
    <h2>Teacher assessment</h2>
    <p className="muted">
      Give each learner a score out of 100 and your comments. It counts for {grades.scheme.teacherWeight} of the
      100 marks in their course result. You can change a score at any time.
    </p>
    {learners.map((learner) => {
      const row = grades.byEmployee.get(learner.employeeId);
      const evaluation = row?.teacherEvaluation ?? null;
      return <details className="teacher-eval" key={learner.employeeId} open={!evaluation}>
        <summary>
          <strong>{learner.name}</strong> <small className="muted">{learner.employeeCode}{learner.classroomName ? ` · ${learner.classroomName}` : ""}</small>{" "}
          {evaluation ? <span className="badge">{evaluation.score}/100</span> : <span className="badge badge-muted">Not assessed</span>}{" "}
          {row && <small className="muted">Course result so far: {row.grade.total}/100</small>}
        </summary>
        <ActionForm action={saveTeacherEvaluation} submitLabel={evaluation ? "Update assessment" : "Save assessment"}>
          <input type="hidden" name="courseId" value={courseId} />
          <input type="hidden" name="employeeId" value={learner.employeeId} />
          <label>Score out of 100<input name="score" type="number" min={0} max={100} step={1} required defaultValue={evaluation?.score ?? ""} /></label>
          <label>Comments<textarea name="comments" maxLength={2000} defaultValue={evaluation?.comments ?? ""} placeholder="What did you observe? Strengths, gaps, and what they should work on." /></label>
          {evaluation && <small className="muted">Last saved {formatIst(evaluation.updatedAt)}</small>}
        </ActionForm>
      </details>;
    })}
    {!learners.length && <p className="muted">No learners to assess.</p>}
  </div>;
}
