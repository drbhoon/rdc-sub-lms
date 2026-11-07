"use client";

import { useActionState, useMemo, useState } from "react";
import { saveGradingScheme } from "@/actions/grading";

type Module = { id: string; label: string; hasAssessment: boolean };
type Scheme = { teacherAssessmentEnabled: boolean; teacherWeight: number; finalWeight: number; moduleWeights: Record<string, number>; overallPassPercent?: number; passMarks?: Record<string, number> };

const DEFAULT_PART_PASS = 70;
const DEFAULT_OVERALL = 75;

const toNumber = (value: string) => (value.trim() === "" ? 0 : Number(value));

/**
 * The weights for one course, with the running total shown as they are typed.
 *
 * The server is what enforces "exactly 100" (checkGradingScheme); the total
 * here is so nobody has to add up ten boxes in their head, and Save stays off
 * until the numbers agree.
 */
export function GradingSchemeForm({ courseId, modules, initial }: { courseId: string; modules: Module[]; initial: Scheme | null }) {
  const [state, formAction, pending] = useActionState(saveGradingScheme, {});
  const [teacherOn, setTeacherOn] = useState(initial?.teacherAssessmentEnabled ?? false);
  const [teacher, setTeacher] = useState(String(initial?.teacherWeight ?? 0));
  const [final, setFinal] = useState(String(initial?.finalWeight ?? 0));
  const [overall, setOverall] = useState(String(initial?.overallPassPercent ?? DEFAULT_OVERALL));
  const [marks, setMarks] = useState<Record<string, string>>(() => {
    const keys = [...modules.map((module) => `module:${module.id}`), "teacher", "final"];
    return Object.fromEntries(keys.map((key) => [key, String(initial?.passMarks?.[key] ?? DEFAULT_PART_PASS)]));
  });
  const [moduleWeights, setModuleWeights] = useState<Record<string, string>>(
    Object.fromEntries(modules.map((module) => [module.id, String(initial?.moduleWeights[module.id] ?? 0)])),
  );

  const total = useMemo(() => {
    const modulesTotal = Object.values(moduleWeights).reduce((sum, value) => sum + (toNumber(value) || 0), 0);
    return modulesTotal + (teacherOn ? toNumber(teacher) || 0 : 0) + (toNumber(final) || 0);
  }, [moduleWeights, teacherOn, teacher, final]);
  const balanced = total === 100;

  const markInput = (key: string) => <input type="number" name={`pass:${key}`} min={0} max={100} step={1} inputMode="numeric" aria-label="Pass mark (%)"
    value={marks[key]} onChange={(event) => setMarks({ ...marks, [key]: event.target.value })} />;

  return <form action={formAction} className="form grading-form">
    <input type="hidden" name="courseId" value={courseId} />
    <p className="muted">
      Each row has a <strong>weight</strong> (how much of the course result it carries) and a <strong>pass mark</strong> (the least a learner
      must score in that part on its own). Put 0 as the pass mark for a part with no minimum of its own.
    </p>
    <p className="weight-row weight-head"><span /><span>Weight</span><span>Pass mark %</span></p>

    <fieldset>
      <legend>a. Module assessments</legend>
      {!modules.length && <p className="muted">This course has no published modules yet.</p>}
      {modules.map((module) => <label key={module.id} className="weight-row">
        <span>{module.label}{!module.hasAssessment && <span className="muted"> (no quiz yet)</span>}</span>
        <input type="number" name={`module:${module.id}`} min={0} max={100} step={1} inputMode="numeric" aria-label="Weight"
          value={moduleWeights[module.id]} onChange={(event) => setModuleWeights({ ...moduleWeights, [module.id]: event.target.value })} />
        {markInput(`module:${module.id}`)}
      </label>)}
    </fieldset>

    <fieldset>
      <legend>b. Teacher assessment (optional)</legend>
      <label className="checkbox"><input type="checkbox" name="teacherAssessmentEnabled" checked={teacherOn} onChange={(event) => setTeacherOn(event.target.checked)} />Teachers give each learner a score out of 100, with comments</label>
      {teacherOn && <label className="weight-row">
        <span>Teacher assessment</span>
        <input type="number" name="teacherWeight" min={0} max={100} step={1} inputMode="numeric" aria-label="Weight" value={teacher} onChange={(event) => setTeacher(event.target.value)} />
        {markInput("teacher")}
      </label>}
    </fieldset>

    <fieldset>
      <legend>c. Final assessment</legend>
      <label className="weight-row">
        <span>Final assessment (questions from every module)</span>
        <input type="number" name="finalWeight" min={0} max={100} step={1} inputMode="numeric" aria-label="Weight" value={final} onChange={(event) => setFinal(event.target.value)} />
        {markInput("final")}
      </label>
    </fieldset>

    <fieldset>
      <legend>d. To get the certificate</legend>
      <label className="weight-row">
        <span>Overall pass mark: the weighted course result must reach</span>
        <input type="number" name="overallPassPercent" min={1} max={100} step={1} inputMode="numeric" value={overall} onChange={(event) => setOverall(event.target.value)} />
        <span className="muted">out of 100</span>
      </label>
      <p className="muted">
        A learner gets the certificate only when every part reaches its own pass mark <em>and</em> the weighted result reaches the overall pass mark
        (as well as finishing the lessons and giving feedback). The module and final quizzes then pass at these same marks.
      </p>
    </fieldset>

    <p className={balanced ? "weight-total weight-total-ok" : "weight-total weight-total-off"} aria-live="polite">
      Total: <strong>{total}</strong> / 100{balanced ? "" : ` - ${total < 100 ? `${100 - total} still to allocate` : `${total - 100} too many`}`}
    </p>
    {state.message && <p className="message">{state.message}</p>}
    <button disabled={pending || !balanced}>{pending ? "Working..." : "Save weights"}</button>
  </form>;
}
