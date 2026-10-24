import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { MAX_REEL_BYTES, MAX_REELS_PER_COURSE, reelFileProblem, reelSeconds } from "@/lib/reels";
import { routeCourseManager } from "@/lib/route-auth";
import { storage } from "@/lib/storage";

function json(body: object, status = 200) {
  return Response.json(body, { status });
}

/**
 * Add an uploaded reel to a course: one request, the video plus its title and
 * caption (a reel is small; see lib/reels.ts). The course's own teachers may
 * add reels as well as admins. No approval step: a reel is a short supplement.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await context.params;
  const actor = await routeCourseManager(courseId);
  if (!actor) return json({ message: "Only an admin or this course's teacher can add reels." }, 403);
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course || course.status === "ARCHIVED") return json({ message: "Course is unavailable." }, 404);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_REEL_BYTES + 1_000_000) {
    return json({ message: `A reel must be under ${MAX_REEL_BYTES / 1048576} MB.` }, 413);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return json({ message: "Choose a video file." }, 400);
  const title = String(form.get("title") ?? "").trim().slice(0, 150);
  if (title.length < 3) return json({ message: "Give the reel a title." }, 400);
  const caption = String(form.get("caption") ?? "").trim().slice(0, 500) || null;
  if (await db.courseReel.count({ where: { courseId } }) >= MAX_REELS_PER_COURSE) return json({ message: `A course can have up to ${MAX_REELS_PER_COURSE} reels.` }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = reelFileProblem({ name: file.name, type: file.type, size: bytes.length }, bytes.slice(0, 16));
  if (problem) return json({ message: problem }, 400);

  const key = `reels/${courseId}/${randomUUID()}.mp4`;
  await storage.put(key, bytes);
  const last = await db.courseReel.aggregate({ where: { courseId }, _max: { order: true } });
  const reel = await db.courseReel.create({
    data: {
      courseId, title, caption, storedKey: key, mimeType: "video/mp4", sizeBytes: bytes.length,
      durationSeconds: reelSeconds(form.get("durationSeconds")), order: (last._max.order ?? 0) + 1,
    },
  });
  await audit(actor.id, "REEL_ADDED", "CourseReel", reel.id, { title, size: bytes.length });
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/teacher/courses/${courseId}`);
  revalidatePath(`/learn/courses/${courseId}`);
  return json({ message: `Added “${title}”.` });
}
