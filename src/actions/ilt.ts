"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireCourseManager } from "@/lib/course-access";
import { createContentWithNextVersion } from "@/lib/course-content";
import { db } from "@/lib/db";
import { canJoin, parseMeetLink, sessionPhase } from "@/lib/ilt";
import { sendSessionEmails, type SessionMailKind } from "@/lib/ilt-mail";
import { setLessonCompletion, refreshEnrollment } from "@/lib/lesson-completion";
import { parseIstLocal } from "@/lib/ist";
import { requireUser } from "@/lib/session";
import { learnersOnly } from "@/lib/teacher-preview";

type State = { message?: string; ok?: boolean };

const sessionFields = z.object({
  title: z.string().trim().min(3, "Give the session a title.").max(150),
  durationMinutes: z.coerce.number().int().min(10, "A session is at least 10 minutes.").max(600, "A session is at most 10 hours."),
  instructorName: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});

function readSession(formData: FormData) {
  const fields = sessionFields.safeParse(Object.fromEntries(formData));
  if (!fields.success) return { error: fields.error.issues[0].message } as const;
  const startsAt = parseIstLocal(String(formData.get("startsAt") ?? ""));
  if (!startsAt) return { error: "Choose the date and time of the session (India time)." } as const;
  if (startsAt.getTime() > Date.now() + 2 * 365 * 86_400_000) return { error: "That date is too far away." } as const;
  const meet = parseMeetLink(String(formData.get("meetUrl") ?? ""));
  if (!meet.ok) return { error: meet.message } as const;
  return {
    values: {
      title: fields.data.title, durationMinutes: fields.data.durationMinutes, startsAt, meetUrl: meet.url,
      instructorName: fields.data.instructorName || null, notes: fields.data.notes || null,
    },
  } as const;
}

async function learnerRecipients(courseId: string) {
  const enrollments = await db.enrollment.findMany({
    where: { courseId, ...learnersOnly, employee: { status: "ACTIVE" } },
    select: { employee: { select: { id: true, name: true, email: true } } },
  });
  return enrollments.map((enrollment) => enrollment.employee);
}

function revalidateCourse(courseId: string) {
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/teacher/courses/${courseId}`);
  revalidatePath(`/learn/courses/${courseId}`);
}

/** Add a live session to an instructor-led course. It is a module of its own, approved and published like any other. */
export async function createIltSession(_: State, formData: FormData): Promise<State> {
  const courseId = String(formData.get("courseId") ?? "");
  const actor = await requireCourseManager(courseId);
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course || course.status === "ARCHIVED") return { message: "Course is unavailable." };
  if (course.kind !== "ILT") return { message: "Live sessions can be added to instructor-led courses only." };
  const read = readSession(formData);
  if ("error" in read) return { message: read.error };
  const { values } = read;

  const content = await createContentWithNextVersion({
    courseId, originalName: values.title, storedKey: `ilt:${randomUUID()}`, mimeType: "application/x-live-session",
    sizeBytes: 0, type: "ILT", processingStatus: "COMPLETED",
    lessons: { create: { title: values.title, type: "ILT", order: 1 } },
  });
  const lesson = await db.lesson.findFirstOrThrow({ where: { courseContentId: content.id } });
  await db.iltSession.create({ data: { courseId, lessonId: lesson.id, ...values } });
  await db.course.update({
    where: { id: courseId },
    data: { status: course.status === "PUBLISHED" ? "PUBLISHED" : "PENDING_TEACHER_APPROVAL", hasPendingChanges: true },
  });
  await audit(actor.id, "ILT_SESSION_CREATED", "CourseContent", content.id, { title: values.title, startsAt: values.startsAt.toISOString() });
  revalidateCourse(courseId);
  return { ok: true, message: `Added “${values.title}”. A teacher approves and publishes it like any other module; then e-mail the invitations.` };
}

/** Change the time, link or details. Learners who were already invited get the new details and an updated calendar entry. */
export async function updateIltSession(_: State, formData: FormData): Promise<State> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const session = await db.iltSession.findUnique({ where: { id: sessionId }, include: { lesson: { include: { content: true } }, course: true } });
  if (!session) return { message: "Session not found." };
  const actor = await requireCourseManager(session.courseId);
  const read = readSession(formData);
  if ("error" in read) return { message: read.error };
  const { values } = read;

  const changedForLearners = values.startsAt.getTime() !== session.startsAt.getTime() || values.durationMinutes !== session.durationMinutes
    || values.meetUrl !== session.meetUrl || values.title !== session.title;
  const updated = await db.iltSession.update({ where: { id: sessionId }, data: values });
  await db.lesson.update({ where: { id: session.lessonId }, data: { title: values.title } });
  await db.courseContent.update({ where: { id: session.lesson.courseContentId }, data: { originalName: values.title } });
  await audit(actor.id, "ILT_SESSION_UPDATED", "IltSession", sessionId, { startsAt: values.startsAt.toISOString(), meetUrl: values.meetUrl });
  revalidateCourse(session.courseId);

  if (changedForLearners && session.invitationsSentAt && !session.cancelledAt) {
    const recipients = await learnerRecipients(session.courseId);
    after(async () => { await sendSessionEmails("update", updated, recipients, session.course.title); });
    return { ok: true, message: `Saved. The ${recipients.length} invited learners are being e-mailed the new details.` };
  }
  return { ok: true, message: "Saved." };
}

/** Called off. It disappears for learners (and from the count of lessons they need), and invited learners are told. */
export async function cancelIltSession(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const session = await db.iltSession.findUnique({ where: { id: sessionId }, include: { lesson: true, course: true } });
  if (!session || session.cancelledAt) return;
  const actor = await requireCourseManager(session.courseId);
  const updated = await db.iltSession.update({ where: { id: sessionId }, data: { cancelledAt: new Date() } });
  await db.courseContent.update({ where: { id: session.lesson.courseContentId }, data: { isPublished: false } });
  // The learners who had attended every other session may now be complete.
  const enrollments = await db.enrollment.findMany({ where: { courseId: session.courseId, ...learnersOnly }, select: { id: true, startedAt: true } });
  for (const enrollment of enrollments) await db.$transaction((tx) => refreshEnrollment(tx, enrollment, session.courseId));
  await audit(actor.id, "ILT_SESSION_CANCELLED", "IltSession", sessionId, { title: session.title });
  if (session.invitationsSentAt) {
    const recipients = await learnerRecipients(session.courseId);
    after(async () => { await sendSessionEmails("cancel", updated, recipients, session.course.title); });
  }
  revalidateCourse(session.courseId);
}

/** E-mail the invitation, with a calendar entry, to every enrolled learner. Only once the session is live for them. */
export async function sendIltInvitations(formData: FormData): Promise<void> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const session = await db.iltSession.findUnique({ where: { id: sessionId }, include: { lesson: { include: { content: true } }, course: true } });
  if (!session || session.cancelledAt) return;
  const actor = await requireCourseManager(session.courseId);
  const live = session.lesson.content.isPublished && session.lesson.content.approvedAt && session.course.status === "PUBLISHED";
  if (!live) throw new Error("Approve and publish this session (and the course) before inviting learners: until then they cannot see it.");
  const recipients = await learnerRecipients(session.courseId);
  const updated = await db.iltSession.update({ where: { id: sessionId }, data: { invitationsSentAt: new Date() } });
  const kind: SessionMailKind = session.invitationsSentAt ? "update" : "invite";
  after(async () => { await sendSessionEmails(kind, updated, recipients, session.course.title); });
  await audit(actor.id, "ILT_INVITATIONS_SENT", "IltSession", sessionId, { recipients: recipients.length });
  revalidateCourse(session.courseId);
}

/**
 * The instructor's attendance sheet. Ticked = present, unticked = absent; saving
 * again corrects it. Present completes the session's lesson for that learner,
 * absent takes the completion back.
 */
export async function markIltAttendance(formData: FormData): Promise<void> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const session = await db.iltSession.findUnique({ where: { id: sessionId } });
  if (!session) return;
  const actor = await requireCourseManager(session.courseId);
  const present = new Set(formData.getAll("present").map(String));
  const enrollments = await db.enrollment.findMany({
    where: { courseId: session.courseId, ...learnersOnly },
    select: { id: true, iltAttendance: { where: { sessionId }, select: { status: true } } },
  });
  let marked = 0;
  for (const enrollment of enrollments) {
    const status = present.has(enrollment.id) ? "PRESENT" : "ABSENT";
    if (enrollment.iltAttendance[0]?.status === status) continue;
    await db.iltAttendance.upsert({
      where: { sessionId_enrollmentId: { sessionId, enrollmentId: enrollment.id } },
      update: { status, markedById: actor.id, markedAt: new Date() },
      create: { sessionId, enrollmentId: enrollment.id, status, markedById: actor.id, markedAt: new Date() },
    });
    await setLessonCompletion(enrollment.id, session.lessonId, status === "PRESENT");
    marked += 1;
  }
  await audit(actor.id, "ILT_ATTENDANCE_MARKED", "IltSession", sessionId, { changed: marked, present: present.size });
  revalidateCourse(session.courseId);
}

/** A learner pressing Join. Recorded as a hint for the instructor, never as attendance. */
export async function recordIltJoin(lessonId: string): Promise<{ meetUrl?: string; error?: string }> {
  const user = await requireUser();
  if (!user.employeeId) return { error: "Learner profile required." };
  const session = await db.iltSession.findUnique({ where: { lessonId } });
  if (!session) return { error: "Session not found." };
  const enrollment = await db.enrollment.findUnique({ where: { employeeId_courseId: { employeeId: user.employeeId, courseId: session.courseId } } });
  if (!enrollment) return { error: "You are not enrolled in this course." };
  if (!canJoin(sessionPhase(session, new Date()))) return { error: "The session is not open yet, or it is over." };
  await db.iltAttendance.upsert({
    where: { sessionId_enrollmentId: { sessionId: session.id, enrollmentId: enrollment.id } },
    update: { joinedClickAt: new Date() },
    create: { sessionId: session.id, enrollmentId: enrollment.id, status: "PENDING", joinedClickAt: new Date() },
  });
  return { meetUrl: session.meetUrl };
}
