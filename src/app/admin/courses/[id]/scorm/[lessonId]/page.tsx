import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { ScormPlayer } from "@/components/scorm-player";
import { db } from "@/lib/db";
import { MAX_SCORM_ATTEMPTS } from "@/lib/scorm-runtime";
import { requireRole } from "@/lib/session";

/** An administrator trying a SCORM course before it goes to learners. Nothing it does is recorded. */
export default async function ScormPreviewPage({ params }: { params: Promise<{ id: string; lessonId: string }> }) {
  await requireRole(UserRole.SUPER_ADMIN);
  const { id, lessonId } = await params;
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, include: { content: true } });
  if (!lesson || lesson.type !== "SCORM" || lesson.content.courseId !== id) notFound();
  return <main className="container">
    <p><Link href={`/admin/courses/${id}`}>&larr; Back to the course</Link></p>
    <section className="card">
      <h1>{lesson.title}</h1>
      <p className="muted">Preview. You are trying the course as a learner would see it; nothing you do here is saved, and it does not use anyone&apos;s attempts.</p>
      <ScormPlayer lessonId={lesson.id} title={lesson.title} standing={{ next: "start", attemptsUsed: 0, maxAttempts: MAX_SCORM_ATTEMPTS, bestScore: null, passed: false }} />
    </section>
  </main>;
}
