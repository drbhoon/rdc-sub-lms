"use client";

import Link from "next/link";
import { useState } from "react";
import { finishAiCourse, startAiCourse, writeAiModule, type StartedCourse } from "@/actions/ai-course";
import { AI_COURSE_LANGUAGE_LABELS, AI_COURSE_LANGUAGES, MAX_AI_MODULES, MAX_BRIEF_CHARACTERS, type AiCourseLanguage } from "@/lib/ai-course";

type ModuleState = { title: string; status: "waiting" | "writing" | "done" | "failed"; error?: string };

/**
 * Describe a course, and have the AI plan and write it as a draft.
 *
 * Done in steps from here rather than in one long request: planning first,
 * then one module at a time, so progress shows, a slow module cannot time the
 * rest out, and one that fails can be tried again on its own.
 */
export function AiCourseWizard({ companies, defaultCompanyIds, reviewBase }: {
  companies: { id: string; name: string }[];
  defaultCompanyIds: string[];
  /** Where the finished draft is reviewed: /teacher/courses or /admin/courses. */
  reviewBase: string;
}) {
  const [brief, setBrief] = useState("");
  const [audience, setAudience] = useState("");
  const [language, setLanguage] = useState<AiCourseLanguage>("en");
  const [moduleCount, setModuleCount] = useState(3);
  const [companyIds, setCompanyIds] = useState<string[]>(defaultCompanyIds);
  const [phase, setPhase] = useState<"form" | "planning" | "writing" | "done">("form");
  const [error, setError] = useState("");
  const [started, setStarted] = useState<StartedCourse | null>(null);
  const [modules, setModules] = useState<ModuleState[]>([]);

  function patch(index: number, change: Partial<ModuleState>) {
    setModules((current) => current.map((module, position) => (position === index ? { ...module, ...change } : module)));
  }

  async function writeOne(course: StartedCourse, index: number) {
    patch(index, { status: "writing", error: undefined });
    const result = await writeAiModule({
      courseId: course.courseId, contentId: course.modules[index].contentId, moduleIndex: index,
      language, audience: audience || undefined, outline: course.outline,
    }).catch(() => ({ error: "The connection was lost. Try this module again." }));
    if ("error" in result) patch(index, { status: "failed", error: result.error });
    else patch(index, { status: "done", title: result.title });
    return !("error" in result);
  }

  async function begin() {
    setError("");
    setPhase("planning");
    const course = await startAiCourse({ brief, audience: audience || undefined, language, modules: moduleCount, companyIds })
      .catch(() => ({ error: "The connection was lost. Nothing was created; try again." }));
    if ("error" in course) { setError(course.error); setPhase("form"); return; }
    setStarted(course);
    setModules(course.modules.map((module) => ({ title: module.title, status: "waiting" })));
    setPhase("writing");
    for (let index = 0; index < course.modules.length; index += 1) await writeOne(course, index);
    await finishAiCourse(course.courseId);
    setPhase("done");
  }

  async function retry(index: number) {
    if (!started) return;
    setPhase("writing");
    await writeOne(started, index);
    await finishAiCourse(started.courseId);
    setPhase("done");
  }

  const failed = modules.filter((module) => module.status === "failed").length;
  const toggleCompany = (id: string) => setCompanyIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  if (phase === "form") {
    return <form className="form" onSubmit={(event) => { event.preventDefault(); void begin(); }}>
      <label>What should the course teach?
        <textarea value={brief} onChange={(event) => setBrief(event.target.value)} rows={5} maxLength={MAX_BRIEF_CHARACTERS} required minLength={15}
          placeholder="For example: A short course for new batching plant operators on how to read a mix design, load materials in the right order and record each batch correctly." />
      </label>
      <label>Who is it for? (optional)
        <input value={audience} onChange={(event) => setAudience(event.target.value)} maxLength={300} placeholder="New plant operators, 0-1 year of experience" />
      </label>
      <div className="form-row">
        <label>Language
          <select value={language} onChange={(event) => setLanguage(event.target.value as AiCourseLanguage)}>
            {AI_COURSE_LANGUAGES.map((code) => <option key={code} value={code}>{AI_COURSE_LANGUAGE_LABELS[code]}</option>)}
          </select>
        </label>
        <label>Number of modules
          <select value={moduleCount} onChange={(event) => setModuleCount(Number(event.target.value))}>
            {Array.from({ length: MAX_AI_MODULES }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
      </div>
      <fieldset>
        <legend>Companies that will take this course</legend>
        {companies.map((company) => <label className="checkbox" key={company.id}>
          <input type="checkbox" checked={companyIds.includes(company.id)} onChange={() => toggleCompany(company.id)} />{company.name}
        </label>)}
      </fieldset>
      <p className="message">
        The AI writes a first draft, which can contain mistakes or things that do not match your plant&apos;s practice. Nothing reaches
        learners until a teacher has read each module and approved it; please read them carefully and fix what needs fixing.
      </p>
      {error && <p className="message" role="alert">{error}</p>}
      <button disabled={!brief.trim() || !companyIds.length}>Create the draft course</button>
    </form>;
  }

  return <div className="ai-progress">
    {phase === "planning" && <p>Planning the course… this takes about 10 seconds.</p>}
    {started && <h2>{started.title}</h2>}
    <ol className="ai-modules">
      {modules.map((module, index) => <li key={index} className={`ai-module ai-${module.status}`}>
        <strong>{module.title}</strong>
        <span>{module.status === "waiting" ? "Waiting" : module.status === "writing" ? "Writing… (about a minute)" : module.status === "done" ? "Written" : "Failed"}</span>
        {module.error && <span className="muted">{module.error}</span>}
        {module.status === "failed" && phase === "done" && <button type="button" className="secondary" onClick={() => void retry(index)}>Try this module again</button>}
      </li>)}
    </ol>
    {phase === "writing" && <p className="muted">Please keep this page open until it finishes.</p>}
    {phase === "done" && started && <div className="card">
      <h3>{failed ? "Draft ready, with gaps" : "Draft ready"}</h3>
      <p>
        {failed ? `${failed} module${failed === 1 ? "" : "s"} could not be written; try again above, or delete ${failed === 1 ? "it" : "them"} on the course page. ` : ""}
        Now read each module, correct what needs correcting, choose the quiz questions you want, and approve it. Only then can the course be published.
      </p>
      <Link className="button" href={`${reviewBase}/${started.courseId}`}>Review the course</Link>
    </div>}
  </div>;
}
