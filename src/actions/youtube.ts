"use server";

import { UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { createContentWithNextVersion } from "@/lib/course-content";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { parseClock, parseYoutubeUrl } from "@/lib/youtube";

type State = { message?: string };

const MIN_SECONDS = 5;
const MAX_SECONDS = 12 * 3600;

/**
 * Whether YouTube will show this video in a page like ours, and what it is called.
 * A private or removed video, or one whose owner has switched off embedding,
 * answers 401/403/404; those are refused here rather than found out by learners.
 * If YouTube cannot be reached from the server at all, the link is accepted
 * and the player will say so to whoever opens it.
 */
async function checkWithYoutube(videoId: string): Promise<{ ok: boolean; title?: string }> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
      { signal: AbortSignal.timeout(6000), cache: "no-store" },
    );
    if (response.status === 401 || response.status === 403 || response.status === 404) return { ok: false };
    if (!response.ok) return { ok: true };
    const body = await response.json() as { title?: string };
    return { ok: true, title: typeof body.title === "string" ? body.title : undefined };
  } catch {
    return { ok: true };
  }
}

/** Add a YouTube video to a course as a module. Needs no upload and no processing. */
export async function addYoutubeContent(_: State, formData: FormData): Promise<State> {
  const actor = await requireRole(UserRole.SUPER_ADMIN);
  const courseId = String(formData.get("courseId") ?? "");
  const videoId = parseYoutubeUrl(String(formData.get("url") ?? ""));
  if (!videoId) return { message: "Paste a YouTube link, for example https://www.youtube.com/watch?v=… or https://youtu.be/…" };

  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course || course.status === "ARCHIVED") return { message: "Course is unavailable." };
  if (course.kind !== "STANDARD") return { message: "YouTube links can be added to standard courses only." };

  const checked = await checkWithYoutube(videoId);
  if (!checked.ok) return { message: "YouTube will not show this video here. It may be private or removed, or its owner may have switched off embedding." };

  const typedLength = String(formData.get("length") ?? "").trim();
  const length = typedLength ? parseClock(typedLength) : Number(formData.get("detectedSeconds") ?? 0) || null;
  if (typedLength && length === null) return { message: "Type the video length as minutes:seconds, for example 12:30." };
  if (length !== null && (length < MIN_SECONDS || length > MAX_SECONDS)) return { message: "The video length looks wrong. Type it as minutes:seconds, for example 12:30." };

  const title = (String(formData.get("title") ?? "").trim() || String(formData.get("detectedTitle") ?? "").trim() || checked.title || "YouTube video").slice(0, 150);
  const content = await createContentWithNextVersion({
    courseId,
    originalName: title,
    storedKey: `youtube:${videoId}`,
    mimeType: "video/youtube",
    sizeBytes: 0,
    type: "YOUTUBE",
    // Nothing to process: the video stays on YouTube. It still waits for a teacher's approval, like any module.
    processingStatus: "COMPLETED",
    lessons: {
      create: {
        title,
        type: "YOUTUBE",
        order: 1,
        externalRef: videoId,
        durationSeconds: length,
        requiredWatchPercent: course.requiredVideoPercent,
      },
    },
  });
  await db.course.update({
    where: { id: courseId },
    data: { status: course.status === "PUBLISHED" ? "PUBLISHED" : "PENDING_TEACHER_APPROVAL", hasPendingChanges: true },
  });
  await audit(actor.id, "YOUTUBE_ADDED", "CourseContent", content.id, { videoId, title, length });
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/teacher/courses/${courseId}`);
  return {
    message: `Added “${title}”. A teacher approves it like any other module. Because the video stays on YouTube, no AI summary or quiz is made for it: add your own questions in the module's quiz.${length ? "" : " Its length is unknown, so it counts as watched when the player reaches the end."}`,
  };
}
