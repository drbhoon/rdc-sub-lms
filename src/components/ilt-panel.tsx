import { cancelIltSession, createIltSession, sendIltInvitations, updateIltSession } from "@/actions/ilt";
import { KeepForm } from "@/components/keep-form";
import { IltAttendanceSheet } from "@/components/ilt-attendance-sheet";
import { db } from "@/lib/db";
import { sessionPhase } from "@/lib/ilt";
import { formatIst, toIstLocalInput } from "@/lib/ist";
import { learnersOnly } from "@/lib/teacher-preview";

const PHASE_LABEL = { cancelled: "Cancelled", upcoming: "Upcoming", open: "Opens soon", live: "Live now", ended: "Ended" } as const;

function SessionFields({ session }: { session?: { title: string; startsAt: Date; durationMinutes: number; meetUrl: string; instructorName: string | null; notes: string | null } }) {
  return <>
    <label>Session title<input name="title" required maxLength={150} defaultValue={session?.title} placeholder="Induction - Day 1" /></label>
    <div className="form-row">
      <label>Date and time (India time)<input name="startsAt" type="datetime-local" required defaultValue={toIstLocalInput(session?.startsAt)} /></label>
      <label>Length (minutes)<input name="durationMinutes" type="number" min="10" max="600" required defaultValue={session?.durationMinutes ?? 60} /></label>
    </div>
    <label>Google Meet link<input name="meetUrl" required defaultValue={session?.meetUrl} placeholder="https://meet.google.com/abc-defg-hij" /></label>
    <label>Instructor<input name="instructorName" maxLength={120} defaultValue={session?.instructorName ?? ""} placeholder="Name shown to learners" /></label>
    <label>Note for learners (optional)<textarea name="notes" maxLength={1000} rows={2} defaultValue={session?.notes ?? ""} /></label>
  </>;
}

/** The live sessions of an instructor-led course: schedule them, invite learners, take attendance. Shared by the admin and teacher course pages. */
export async function IltPanel({ courseId }: { courseId: string }) {
  const [sessions, enrollments] = await Promise.all([
    db.iltSession.findMany({
      where: { courseId },
      include: { lesson: { include: { content: true } }, attendance: true },
      orderBy: { startsAt: "asc" },
    }),
    db.enrollment.findMany({
      where: { courseId, ...learnersOnly },
      select: { id: true, employee: { select: { name: true, employeeCode: true } } },
      orderBy: { employee: { name: "asc" } },
    }),
  ]);
  const now = new Date();

  return <section className="card ilt-panel">
    <h2>Live sessions</h2>
    <p className="muted">
      Each session is a module of this course. Learners complete it by attending: you confirm who was present after the session.
      Their assessment and feedback work as in any other course, on each session&apos;s module.
    </p>
    {!sessions.length && <p>No sessions yet.</p>}
    {sessions.map((session) => {
      const phase = sessionPhase(session, now);
      const content = session.lesson.content;
      const live = content.isPublished && Boolean(content.approvedAt);
      const rows = enrollments.map((enrollment) => {
        const record = session.attendance.find((item) => item.enrollmentId === enrollment.id);
        return {
          enrollmentId: enrollment.id, name: enrollment.employee.name, code: enrollment.employee.employeeCode,
          present: record?.status === "PRESENT", joinedAt: record?.joinedClickAt ? formatIst(record.joinedClickAt) : null,
        };
      });
      return <div className="card ilt-session" key={session.id}>
        <div className="ilt-session-head">
          <strong>{session.title}</strong>
          <span className="badge">{PHASE_LABEL[phase]}</span>
          {!session.cancelledAt && <span className="badge">{live ? "Visible to learners" : content.rejectedAt ? "Rejected" : "Awaiting approval"}</span>}
        </div>
        <p>{formatIst(session.startsAt)} · {session.durationMinutes} minutes{session.instructorName ? ` · ${session.instructorName}` : ""}</p>
        <p><a href={session.meetUrl} target="_blank" rel="noreferrer">{session.meetUrl}</a></p>
        {session.invitationsSentAt && <p className="muted">Invitations e-mailed {formatIst(session.invitationsSentAt)}.</p>}
        {!session.cancelledAt && <div className="button-row">
          <form action={sendIltInvitations}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button type="submit" className="secondary" disabled={!live}>{session.invitationsSentAt ? "E-mail invitations again" : "E-mail invitations"}</button>
          </form>
          <form action={cancelIltSession}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button type="submit" className="danger">Cancel session</button>
          </form>
        </div>}
        {!session.cancelledAt && !live && <p className="muted">Invitations can be sent once a teacher has approved and published this module.</p>}
        {!session.cancelledAt && <>
          <details>
            <summary>Edit time, link or details</summary>
            <KeepForm action={updateIltSession} submitLabel="Save changes">
              <input type="hidden" name="sessionId" value={session.id} />
              <SessionFields session={session} />
            </KeepForm>
          </details>
          <details>
            <summary>Attendance ({rows.filter((row) => row.present).length} of {rows.length} present)</summary>
            <IltAttendanceSheet sessionId={session.id} rows={rows} />
          </details>
        </>}
      </div>;
    })}
    <hr />
    <h3>Add a session</h3>
    <KeepForm action={createIltSession} submitLabel="Add session" clearOnSuccess>
      <input type="hidden" name="courseId" value={courseId} />
      <SessionFields />
    </KeepForm>
  </section>;
}
