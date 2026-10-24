"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireCourseManager } from "@/lib/course-access";
import { db } from "@/lib/db";
import { MAX_REELS_PER_COURSE, reelSeconds, reelWatched } from "@/lib/reels";
import { requireUser } from "@/lib/session";
import { storage } from "@/lib/storage";
import { parseYoutubeUrl } from "@/lib/youtube";

type State = { message?: string; ok?: boolean };

function revalidateCourse(courseId: string) {
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/teacher/courses/${courseId}`);
  revalidatePath(`/learn/courses/${courseId}`);
}

/** A YouTube Short (or any short YouTube video) as a reel. It plays from YouTube, so the learner note about that applies. */
export async function addYoutubeReel(_: State, formData: FormData): Promise<State> {
  const courseId = String(formData.get("courseId") ?? "");
  const actor = await requireCourseManager(courseId);
  const videoId = parseYoutubeUrl(String(formData.get("url") ?? ""));
  if (!videoId) return { message: "Paste a YouTube link, for example https://www.youtube.com/shorts/… or https://youtu.be/…" };
  const title = String(formData.get("title") ?? "").trim().slice(0, 150);
  if (title.length < 3) return { message: "Give the reel a title." };
  if (await db.courseReel.count({ where: { courseId } }) >= MAX_REELS_PER_COURSE) return { message: `A course can have up to ${MAX_REELS_PER_COURSE} reels.` };
  const last = await db.courseReel.aggregate({ where: { courseId }, _max: { order: true } });
  const reel = await db.courseReel.create({
    data: {
      courseId, title, caption: String(formData.get("caption") ?? "").trim().slice(0, 500) || null, youtubeId: videoId,
      durationSeconds: reelSeconds(formData.get("durationSeconds")), order: (last._max.order ?? 0) + 1,
    },
  });
  await audit(actor.id, "REEL_ADDED", "CourseReel", reel.id, { title, videoId });
  revalidateCourse(courseId);
  return { ok: true, message: `Added “${title}”. Because it plays from YouTube, learners need YouTube to be reachable from their device.` };
}

async function reelForManager(reelId: string) {
  const reel = await db.courseReel.findUnique({ where: { id: reelId } });
  if (!reel) return null;
  const actor = await requireCourseManager(reel.courseId);
  return { reel, actor };
}

/** Hide a reel from learners without losing it, or show it again. */
export async function setReelActive(formData: FormData): Promise<void> {
  const found = await reelForManager(String(formData.get("reelId") ?? ""));
  if (!found) return;
  await db.courseReel.update({ where: { id: found.reel.id }, data: { isActive: formData.get("active") === "1" } });
  revalidateCourse(found.reel.courseId);
}

export async function deleteReel(formData: FormData): Promise<void> {
  const found = await reelForManager(String(formData.get("reelId") ?? ""));
  if (!found) return;
  await db.courseReel.delete({ where: { id: found.reel.id } });
  if (found.reel.storedKey) await storage.delete(found.reel.storedKey);
  await audit(found.actor.id, "REEL_DELETED", "CourseReel", found.reel.id, { title: found.reel.title });
  revalidateCourse(found.reel.courseId);
}

/** A learner's watching of a reel. Kept per learner, never required. */
export async function recordReelView(reelId: string, watchedSeconds: number, ended: boolean): Promise<void> {
  const user = await requireUser();
  if (!user.employeeId) return;
  const reel = await db.courseReel.findUnique({ where: { id: reelId }, include: { course: true } });
  if (!reel || !reel.isActive || reel.course.status !== "PUBLISHED") return;
  const enrolled = await db.enrollment.findUnique({ where: { employeeId_courseId: { employeeId: user.employeeId, courseId: reel.courseId } } });
  if (!enrolled) return;
  const seconds = Math.max(0, Math.min(Math.floor(Number(watchedSeconds) || 0), 600));
  const existing = await db.reelView.findUnique({ where: { reelId_employeeId: { reelId, employeeId: user.employeeId } } });
  const best = Math.max(existing?.watchedSeconds ?? 0, seconds);
  const completed = (existing?.completed ?? false) || reelWatched(best, reel.durationSeconds, ended);
  if (existing && existing.watchedSeconds === best && existing.completed === completed) return;
  await db.reelView.upsert({
    where: { reelId_employeeId: { reelId, employeeId: user.employeeId } },
    update: { watchedSeconds: best, completed },
    create: { reelId, employeeId: user.employeeId, watchedSeconds: best, completed },
  });
}
