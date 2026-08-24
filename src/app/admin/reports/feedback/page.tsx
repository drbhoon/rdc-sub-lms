import { UserRole } from "@prisma/client";
import Link from "next/link";
import { withBase } from "@/lib/base-path";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

function value(params: Record<string, string | string[] | undefined>, key: string) {
  const item = params[key];
  return Array.isArray(item) ? item[0] ?? "" : item ?? "";
}

function text(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join("; ");
  return String(value ?? "");
}

export default async function FeedbackReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(UserRole.SUPER_ADMIN);
  const params = await searchParams;
  const courses = await db.course.findMany({
    where: { feedbackForms: { some: {} } },
    select: { id: true, title: true, feedbackForms: { select: { id: true, title: true, version: true }, orderBy: { version: "desc" } } },
    orderBy: { title: "asc" },
  });
  const selectedCourseId = value(params, "courseId") || courses[0]?.id || "";
  const selectedCourse = courses.find((course) => course.id === selectedCourseId);
  const selectedFormId = value(params, "formId") || selectedCourse?.feedbackForms[0]?.id || "";
  const form = selectedFormId ? await db.feedbackForm.findFirst({
    where: { id: selectedFormId, courseId: selectedCourseId },
    include: {
      course: true,
      questions: { orderBy: { order: "asc" } },
      // courseContent + its lesson so the "Individual responses" table can
      // label which module each row is about. With feedback answered per
      // module, one learner now legitimately has several rows per form.
      responses: { include: { employee: { include: { company: true } }, courseContent: { include: { lessons: true } }, answers: true }, orderBy: { submittedAt: "desc" } },
    },
  }) : null;
  const ratingValues = form?.questions.filter((question) => question.type === "RATING_1_5").flatMap((question) => form.responses.flatMap((response) => {
    const answer = response.answers.find((item) => item.questionId === question.id);
    const number = Number(text(answer?.value));
    return Number.isFinite(number) ? [number] : [];
  })) ?? [];
  const averageRating = ratingValues.length ? Math.round(ratingValues.reduce((sum, item) => sum + item, 0) / ratingValues.length * 10) / 10 : 0;

  return <main className="container">
    <h1>Feedback reports</h1>
    <nav className="report-tabs" aria-label="Report sections"><Link href="/admin/reports">General</Link><Link href="/admin/reports/assessment">Assessment</Link><Link className="active" href="/admin/reports/feedback">Feedback</Link></nav>
    <form className="period-filter card" method="get">
      <label>Course<select name="courseId" defaultValue={selectedCourseId}>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
      <label>Feedback version<select name="formId" defaultValue={selectedFormId}>{selectedCourse?.feedbackForms.map((item) => <option key={item.id} value={item.id}>v{item.version} - {item.title}</option>)}</select></label>
      <button>Apply</button>
      {form && <a className="button secondary" href={withBase(`/api/courses/${form.courseId}/feedback-export?formId=${form.id}`)}>Download Overview & Details Excel</a>}
    </form>
    {!form ? <div className="card"><p>No feedback form is available.</p></div> : <>
      <div className="grid"><div className="card"><div className="stat">{form.responses.length}</div><p>Responses</p></div><div className="card"><div className="stat">{form.questions.length}</div><p>Questions</p></div><div className="card"><div className="stat">{averageRating || "-"}</div><p>Average rating across rating questions</p></div></div>
      <section className="card dashboard-row"><h2>Overview: response summary</h2><div className="table-wrap"><table><thead><tr><th>Question</th><th>Text</th><th>Type</th><th>Responses</th><th>Distribution / Summary</th></tr></thead><tbody>
        {form.questions.map((question) => {
          const values = form.responses.flatMap((response) => {
            const answer = response.answers.find((item) => item.questionId === question.id);
            return Array.isArray(answer?.value) ? (answer.value as unknown[]).map(String) : answer ? [text(answer.value)] : [];
          });
          const options = question.type === "RATING_1_5" ? ["1", "2", "3", "4", "5"] : question.type === "YES_NO" ? ["Yes", "No"] : Array.isArray(question.options) ? question.options.map(String) : [];
          const summary = options.length ? options.map((option) => {
            const count = values.filter((item) => item.toLowerCase() === option.toLowerCase()).length;
            return `${option}: ${count} (${values.length ? Math.round(count / values.length * 100) : 0}%)`;
          }).join(" | ") : "Individual text responses are shown below";
          return <tr key={question.id}><td>Q{question.order}</td><td>{question.questionText}</td><td>{question.type.replaceAll("_", " ")}</td><td>{values.length}</td><td>{summary}</td></tr>;
        })}
      </tbody></table></div></section>
      <section className="card"><h2>Individual responses</h2><div className="table-wrap"><table><thead><tr><th>Learner</th><th>Company</th><th>Module</th><th>Submitted</th>{form.questions.map((question) => <th key={question.id}>Q{question.order}</th>)}</tr></thead><tbody>
        {form.responses.map((response) => { const answers = new Map(response.answers.map((answer) => [answer.questionId, answer.value])); return <tr key={response.id}><td>{response.employee.name}<br /><span className="muted">{response.employee.employeeCode}</span></td><td>{response.employee.company.name}</td><td>{response.courseContent?.lessons[0]?.title ?? "Whole course"}</td><td>{response.submittedAt.toLocaleString("en-IN")}</td>{form.questions.map((question) => <td key={question.id}>{text(answers.get(question.id))}</td>)}</tr>; })}
        {!form.responses.length && <tr><td colSpan={4 + form.questions.length}>No feedback responses yet.</td></tr>}
      </tbody></table></div></section>
    </>}
  </main>;
}
